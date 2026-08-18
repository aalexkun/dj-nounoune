(function () {
  'use strict';

  var el = {
    dot: document.getElementById('live-dot'),
    status: document.getElementById('rail-status'),
    vinyl: document.getElementById('vinyl'),
    cover: document.getElementById('cover'),
    coverPlaceholder: document.getElementById('cover-placeholder'),
    eyebrow: document.getElementById('eyebrow'),
    title: document.getElementById('title'),
    artist: document.getElementById('artist'),
    badges: document.getElementById('badges'),
    narration: document.querySelector('.narration'),
    description: document.getElementById('description'),
    detailsGrid: document.getElementById('details-grid'),
    recentSection: document.getElementById('recent-section'),
    recent: document.getElementById('recent'),
    controlPrevious: document.getElementById('control-previous'),
    controlToggle: document.getElementById('control-toggle'),
    controlToggleIcon: document.getElementById('control-toggle-icon'),
    controlNext: document.getElementById('control-next'),
    controlNote: document.getElementById('control-note'),
    reactions: document.getElementById('reactions'),
    reactionStage: document.getElementById('reaction-stage'),
    clock: document.getElementById('clock'),
    weather: document.getElementById('weather'),
    weatherIcon: document.getElementById('weather-icon'),
    weatherTemp: document.getElementById('weather-temp'),
    weatherWord: document.getElementById('weather-word'),
    weatherForecast: document.getElementById('weather-forecast'),
  };

  // ---------------------------------------------------------------------------------------------
  // Trace. The display runs unattended on a television, so a disconnect nobody saw is the whole
  // problem: keep a ring buffer in the page, mirror it to the console, ship the meaningful lines up
  // to the server, and put it on screen when the url carries ?debug.
  // ---------------------------------------------------------------------------------------------

  var LOG_LIMIT = 200;
  var SHIP_LIMIT = 100;
  var DEBUG_OVERLAY = /(^|[?&])debug($|[=&])/.test(window.location.search);

  var trace = { logs: [], pending: [], overlay: null };

  function stamp() {
    return new Date().toTimeString().slice(0, 8);
  }

  /** Console and ring buffer only. Use for anything that fires every second. */
  function log(kind, message) {
    var entry = { at: stamp(), kind: kind, message: String(message) };

    trace.logs.push(entry);
    if (trace.logs.length > LOG_LIMIT) trace.logs.shift();

    console.log('[vibing ' + entry.at + '] ' + entry.kind + ': ' + entry.message);
    paintOverlay();

    return entry;
  }

  /** Logged here and queued for the server, so an unattended display leaves a trail behind it. */
  function report(kind, message) {
    var entry = log(kind, message);

    trace.pending.push(entry);
    if (trace.pending.length > SHIP_LIMIT) trace.pending.shift();

    shipLogs();
  }

  function shipLogs() {
    if (trace.pending.length === 0) return;
    if (!socket || !socket.connected) return;

    var entries = trace.pending.splice(0, 25);
    socket.emit('vibing-client-log', { entries: entries });
  }

  function paintOverlay() {
    if (!DEBUG_OVERLAY) return;

    if (!trace.overlay) {
      trace.overlay = document.createElement('pre');
      trace.overlay.style.cssText =
        'position:fixed;left:0;bottom:0;z-index:9999;margin:0;padding:8px 12px;max-height:38vh;' +
        'overflow:hidden;font:11px/1.45 ui-monospace,monospace;color:#9fe8c0;background:rgba(0,0,0,.72);' +
        'white-space:pre-wrap;pointer-events:none;max-width:min(680px,100vw)';
      document.body.appendChild(trace.overlay);
    }

    trace.overlay.textContent = trace.logs
      .slice(-14)
      .map(function (entry) {
        return entry.at + ' ' + entry.kind + ': ' + entry.message;
      })
      .join('\n');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function inline(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  // Just enough markdown for what the disc jockey emits: headings, rules, bullets, bold and italics.
  // Line based rather than block based — it writes headings without a blank line under them.
  function renderMarkdown(markdown) {
    var html = '';
    var paragraph = [];
    var items = [];

    function flushParagraph() {
      if (paragraph.length === 0) return;
      var text = paragraph.join('\n').replace(/^([^\n:]{2,40}):\s/, '<strong>$1:</strong> ');
      html += '<p>' + inline(text).replace(/\n/g, '<br />') + '</p>';
      paragraph = [];
    }

    function flushList() {
      if (items.length === 0) return;
      html += '<ul>' + items.join('') + '</ul>';
      items = [];
    }

    function flush() {
      flushParagraph();
      flushList();
    }

    escapeHtml(markdown)
      .split('\n')
      .forEach(function (raw) {
        var line = raw.trim();

        if (!line || /^([-*_])\1{2,}$/.test(line)) {
          flush();
          return;
        }

        var heading = line.match(/^#{1,6}\s+(.*)$/);
        if (heading) {
          flush();
          html += '<h3>' + inline(heading[1]) + '</h3>';
          return;
        }

        var bullet = line.match(/^[*-]\s+(.*)$/);
        if (bullet) {
          flushParagraph();
          items.push('<li>' + inline(bullet[1]) + '</li>');
          return;
        }

        flushList();
        paragraph.push(line);
      });

    flush();
    return html;
  }

  // Nothing to show beats an empty square: the cat holds the panel until artwork turns up.
  var DEFAULT_COVER = '/vibing-on/assets/vibe-cat.gif';

  /**
   * Either way the artwork fills the sleeve, which is what holds the square open — so the panel never
   * resizes under artwork arriving. Real artwork drops in as a plain square; without any, the cat
   * takes the front and the sleeve dresses itself up around it, record and all.
   */
  function setCover(url) {
    el.cover.src = url || DEFAULT_COVER;
    el.cover.classList.toggle('cover-default', !url);
    el.cover.hidden = false;
    el.vinyl.classList.toggle('framed', !url);
    el.coverPlaceholder.hidden = true;
  }

  el.cover.addEventListener('error', function () {
    // Discogs' CDN blocks hotlinking, so a resolved URL can still fail to load.
    if (el.cover.getAttribute('src') === DEFAULT_COVER) {
      // The fallback itself is missing — leave the sleeve up, empty, and let the drawn placeholder
      // stand in on its front rather than loop on the error.
      el.cover.hidden = true;
      el.cover.removeAttribute('src');
      el.cover.classList.remove('cover-default');
      el.coverPlaceholder.hidden = false;
      return;
    }

    report('cover', 'failed to load ' + el.cover.getAttribute('src'));
    setCover(null);
  });

  function formatDuration(seconds) {
    if (!seconds) return null;
    var total = Math.round(seconds);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  /**
   * Rendered in kilohertz: 96000 → 96, 44100 → 44.1. The column holds both scales — most rows are in
   * hertz, but ~1.5k Qobuz imports stored the kilohertz figure the API hands back (44, 88, 176) — and
   * no real rate sits between the two, so the magnitude is enough to tell them apart.
   */
  function formatSampleRate(rate) {
    if (!rate) return null;
    var kilohertz = rate < 1000 ? rate : rate / 1000;
    return String(Math.round(kilohertz * 10) / 10);
  }

  /**
   * Rendered in kilobits per second. Two scales again: the ffprobe enrichment stores bits per second
   * (320000) while the older imports stored kilobits (128). Nothing real lands near 10000 either way
   * — the highest kilobit figure in the library is 9216, the lowest bit figure 16456 — so that is
   * where the two are split. Qobuz rows carry a 0, meaning "not measured", and drop out here.
   */
  function formatBitrate(bitrate) {
    if (!bitrate) return null;
    var kilobits = bitrate < 10000 ? bitrate : bitrate / 1000;
    return Math.round(kilobits) + ' kbps';
  }

  /**
   * The resolution the way a spec sheet writes it — sample rate first, then bit depth, so a hi-res
   * FLAC reads `96/24`. Either half alone still says something, so it gets its own unit.
   */
  function formatResolution(song) {
    var rate = formatSampleRate(song.sampleRate);

    if (rate && song.bitDepth) return rate + '/' + song.bitDepth;
    if (rate) return rate + ' kHz';
    if (song.bitDepth) return song.bitDepth + '-bit';
    return null;
  }

  /**
   * The quality tier, named the way the stores name it, and only the top one that applies — hi-res
   * is CD quality too, and saying both says nothing. Its own tone rather than the accent the rest of
   * the page uses, so the tier reads at a glance from across the room.
   */
  function qualityBadge(song) {
    if (song.isHighRes) return { text: 'hi-res audio', tone: 'hires' };
    if (song.isCdQuality) return { text: 'cd quality', tone: 'cd' };
    return null;
  }

  function renderBadges(song) {
    var badges = [];

    // Technical strip first: tier, then the numbers behind it, then where the bytes came from. The
    // file sources carry the same technical_info Qobuz does, so a local FLAC gets the same tag.
    var quality = qualityBadge(song);
    if (quality) badges.push(quality);

    var resolution = formatResolution(song);
    if (resolution) badges.push({ text: resolution, tone: 'spec' });

    var bitrate = formatBitrate(song.bitrate);
    if (bitrate) badges.push({ text: bitrate, tone: 'spec' });

    if (song.encoding) badges.push({ text: String(song.encoding).toLowerCase(), tone: 'spec' });
    if (song.sourceName) badges.push({ text: song.sourceName });
    if (song.bpm) badges.push({ text: Math.round(song.bpm) + ' bpm' });
    var duration = formatDuration(song.duration);
    if (duration) badges.push({ text: duration });

    el.badges.innerHTML = badges
      .map(function (badge) {
        var className = 'badge' + (badge.tone ? ' badge-' + badge.tone : '');
        return '<span class="' + className + '">' + escapeHtml(badge.text) + '</span>';
      })
      .join('');
  }

  function renderDetails(song) {
    var rows = [
      ['mood', song.emotion],
      ['pace', song.pace],
      ['genre', song.genre],
      ['category', song.category],
      ['year', song.year],
      ['label', song.label],
      ['origin', [song.country, song.language].filter(Boolean).join(' · ')],
    ];

    el.detailsGrid.innerHTML = rows
      .filter(function (row) {
        return row[1];
      })
      .map(function (row) {
        return '<dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd>';
      })
      .join('');
  }

  function renderRecent(recent) {
    if (!recent || recent.length === 0) {
      el.recentSection.hidden = true;
      return;
    }

    el.recentSection.hidden = false;
    el.recent.innerHTML = recent
      .map(function (item) {
        var cover = item.coverUrl
          ? '<img class="recent-cover" src="' + escapeHtml(item.coverUrl) + '" alt="" referrerpolicy="no-referrer" />'
          : '<div class="recent-cover"></div>';
        return (
          '<div class="recent-item">' +
          cover +
          '<div class="recent-meta">' +
          '<div class="recent-title">' + escapeHtml(item.title) + '</div>' +
          '<div class="recent-artist">' + escapeHtml(item.artist) + '</div>' +
          '</div></div>'
        );
      })
      .join('');
  }

  var drift = null;

  // How long the drift rests at the top and at the bottom of the commentary.
  var DRIFT_HOLD_MS = 8000;
  // And how long it leaves the column alone after somebody has scrolled it themselves.
  var DRIFT_RESUME_MS = 6000;
  // Anything further than this from where we last put the column is somebody else's doing.
  var DRIFT_SLACK_PX = 2;

  /**
   * The commentary is usually taller than its column, and nobody scrolls a television. So once a
   * track settles, walk the narration down at reading pace, hold at the end, and start over.
   *
   * A hand on the wheel wins, though: `startAt` lets the walk pick up from wherever the column was
   * left rather than snapping back to the offset it was heading for, and `delay` gives the reader a
   * longer pause before it starts moving again.
   */
  function driftNarration(startAt, delay) {
    var node = el.narration;

    if (drift) {
      cancelAnimationFrame(drift.frame);
      clearTimeout(drift.timer);
      drift = null;
    }

    var maximum = Math.max(0, node.scrollHeight - node.clientHeight);
    var offset = Math.min(Math.max(startAt || 0, 0), maximum);

    node.scrollTop = offset;

    if (node.scrollHeight <= node.clientHeight + 4) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Roughly a line every two seconds, whatever the display scales the text to.
    var pixelsPerSecond = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.505;
    // Written rather than read back: the scroll listener below compares against it to tell our own
    // steps apart from a reader's, and browsers round `scrollTop` to whole pixels on the way in.
    var state = { frame: 0, timer: 0, written: node.scrollTop };
    drift = state;

    function step(previous) {
      return function (now) {
        // Kept in a variable rather than read back off scrollTop, which rounds sub-pixel steps away.
        offset += (pixelsPerSecond * (now - previous)) / 1000;
        node.scrollTop = offset;
        state.written = node.scrollTop;

        if (offset + node.clientHeight >= node.scrollHeight - 1) {
          state.timer = setTimeout(function () {
            offset = 0;
            node.scrollTop = 0;
            state.written = node.scrollTop;
            state.timer = setTimeout(begin, DRIFT_HOLD_MS);
          }, DRIFT_HOLD_MS);
          return;
        }

        state.frame = requestAnimationFrame(step(now));
      };
    }

    function begin() {
      state.frame = requestAnimationFrame(function (now) {
        state.frame = requestAnimationFrame(step(now));
      });
    }

    state.timer = setTimeout(begin, delay === undefined ? DRIFT_HOLD_MS : delay);
  }

  /**
   * Someone scrolled the commentary by hand — either while the drift was resting or straight over
   * the top of it. Restart the walk from where they left the column, after a pause long enough to
   * finish reading the paragraph they scrolled to.
   */
  el.narration.addEventListener('scroll', function () {
    if (!drift) return;
    if (Math.abs(el.narration.scrollTop - drift.written) <= DRIFT_SLACK_PX) return;

    driftNarration(el.narration.scrollTop, DRIFT_RESUME_MS);
  });

  var current = { songId: null, description: null, coverUrl: null };

  /**
   * Entry point for a whole snapshot, from the socket or the poll. A new track repaints everything;
   * the same track only takes the parts that changed, so a late commentary or cover does not restart
   * the narration drift.
   */
  function apply(song) {
    if (!song || !song.songId) return;

    if (song.songId !== current.songId) {
      render(song);
      return;
    }

    applyCommentary(song);
    applyCover(song);
  }

  function applyCommentary(payload) {
    if (!payload || payload.songId !== current.songId) return;
    if (!payload.description || payload.description === current.description) return;

    current.description = payload.description;
    el.description.innerHTML = renderMarkdown(payload.description);
    driftNarration();
  }

  function applyCover(payload) {
    if (!payload || payload.songId !== current.songId) return;
    if (!payload.coverUrl || payload.coverUrl === current.coverUrl) return;

    current.coverUrl = payload.coverUrl;
    setCover(payload.coverUrl);
  }

  function render(song) {
    if (!song || !song.songId) return;

    current = { songId: song.songId, description: song.description || null, coverUrl: song.coverUrl || null };

    document.title = song.title + ' — ' + song.artist;

    var eyebrow = [];
    if (song.trackNumber) eyebrow.push('track ' + song.trackNumber);
    if (song.album) eyebrow.push(song.album);
    el.eyebrow.textContent = eyebrow.join(' · ');

    el.title.textContent = song.title;
    el.artist.textContent = song.artist;

    setCover(song.coverUrl);
    renderBadges(song);
    renderDetails(song);
    renderRecent(song.recent);

    if (song.description) {
      el.description.innerHTML = renderMarkdown(song.description);
    } else if (song.artistIntro) {
      el.description.innerHTML = renderMarkdown(song.artistIntro);
    } else {
      el.description.innerHTML = '<p class="waiting">waiting for the disc jockey…</p>';
    }

    driftNarration();
  }

  /**
   * The reactions live under the transport, except on a letterbox display where the hero column has
   * no height to spare and they go to the foot of the details column instead. Which of the two is a
   * layout question, and the layout lives in the stylesheet — so the CSS names the mode through
   * `--layout` and this only moves the node to match. One copy of the markup, one definition of the
   * breakpoint, and nothing to keep in step by hand.
   */
  function placeReactions() {
    var layout = getComputedStyle(document.documentElement).getPropertyValue('--layout').trim();
    var target = document.querySelector(layout === 'letterbox' ? '.details' : '.hero-text');

    if (!target || el.reactions.parentNode === target) return;

    target.appendChild(el.reactions);
    log('layout', 'reactions moved to the ' + (layout === 'letterbox' ? 'details' : 'hero') + ' column');
  }

  window.addEventListener('resize', function () {
    driftNarration();
    placeReactions();
  });

  placeReactions();

  function setConnected(connected, label) {
    el.dot.className = connected ? 'dot' : 'dot offline';
    el.status.textContent = label;
  }

  // -------------------------------------------------------------------------------------------
  // Clock, weather and the sky.
  //
  // All three run off one minute tick and one snapshot. `GET /vibing-on/weather` answers with the
  // conditions, a five day outlook and — the part the rest of this section is really about — the
  // sunrise and sunset of each of those days as plain epoch milliseconds. The page has no idea where
  // it is and does not need one: it interpolates a colour between those two instants and paints the
  // background with it, so the black the display had at three in the morning becomes a blue at noon
  // and finds its way back again, on the sun's schedule rather than a fixed hour.
  //
  // Nothing here is load bearing. With the weather upstream down, or the feature switched off, the
  // clock keeps time and the sky falls back to a six to six day.
  // -------------------------------------------------------------------------------------------

  var MINUTE_MS = 60000;
  var WEATHER_REFRESH_MS = 10 * MINUTE_MS;

  var weather = { snapshot: null, days: null };

  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function paintClock() {
    var now = new Date();
    el.clock.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
  }

  // --- weather -------------------------------------------------------------------------------

  /* Stroke glyphs on `currentColor`, so each one takes the ink of whatever line it is drawn on and
     the header keeps one palette. Same set the forecast row uses at two thirds the size. */
  var ICONS = {
    sun:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="4.6" /><path d="M12 1.5v2M12 20.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4' +
      'M1.5 12h2M20.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>',
    moon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>',
    cloud:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /></svg>',
    partly:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 2v1.8M5.3 5.3l1.3 1.3M2 12h1.8M18.7 5.3l-1.3 1.3M22 12h-1.8" />' +
      '<path d="M12 6.2a5.8 5.8 0 0 0-4 10.2" />' +
      '<path d="M17.5 19H9a5 5 0 1 1 4.08-7.92A4.5 4.5 0 1 1 17.5 19z" /></svg>',
    'partly-night':
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M15.5 3.2A5.4 5.4 0 0 0 20.8 10a5.4 5.4 0 1 1-5.3-6.8z" />' +
      '<path d="M17.5 19H9a5 5 0 1 1 4.08-7.92A4.5 4.5 0 1 1 17.5 19z" /></svg>',
    fog:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M16.5 14H9a5 5 0 1 1 4.08-7.92A4.5 4.5 0 1 1 16.5 14z" />' +
      '<path d="M4 18h13M7 21.5h11" /></svg>',
    rain:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M19 15.6A4.6 4.6 0 0 0 17.5 7h-1.2A7 7 0 1 0 5 13.9" />' +
      '<path d="M8.5 15.5 7.5 19M12.5 15.5 11.5 19M16.5 15.5 15.5 19" /></svg>',
    snow:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M19 15.6A4.6 4.6 0 0 0 17.5 7h-1.2A7 7 0 1 0 5 13.9" />' +
      '<path d="M8 18h.01M12 20h.01M16 18h.01" /></svg>',
    storm:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M19 15.6A4.6 4.6 0 0 0 17.5 7h-1.2A7 7 0 1 0 5 13.9" />' +
      '<path d="m13 14-3 4.5h3.6L11 23" /></svg>',
  };

  /**
   * WMO weather interpretation code to a glyph and a word. The server passes the code through
   * untouched, so this table is the only place the two are decided and the forecast row and the
   * current conditions cannot drift apart.
   */
  function weatherLook(code, daylight) {
    if (code === 0) return { icon: daylight ? 'sun' : 'moon', word: 'clear' };
    if (code === 1) return { icon: daylight ? 'sun' : 'moon', word: 'mostly clear' };
    if (code === 2) return { icon: daylight ? 'partly' : 'partly-night', word: 'partly cloudy' };
    if (code === 3) return { icon: 'cloud', word: 'overcast' };
    if (code === 45 || code === 48) return { icon: 'fog', word: 'fog' };
    if (code >= 51 && code <= 57) return { icon: 'rain', word: 'drizzle' };
    if (code >= 61 && code <= 67) return { icon: 'rain', word: 'rain' };
    if (code === 71 || code === 73 || code === 75 || code === 77) return { icon: 'snow', word: 'snow' };
    if (code >= 80 && code <= 82) return { icon: 'rain', word: 'showers' };
    if (code === 85 || code === 86) return { icon: 'snow', word: 'snow showers' };
    if (code >= 95) return { icon: 'storm', word: 'thunderstorm' };

    return { icon: 'cloud', word: '' };
  }

  function iconMarkup(name) {
    return ICONS[name] || ICONS.cloud;
  }

  function temperature(value) {
    return typeof value === 'number' ? Math.round(value) + '°' : '--°';
  }

  function paintWeather() {
    var snapshot = weather.snapshot;

    if (!snapshot) {
      el.weather.hidden = true;
      return;
    }

    // The snapshot is up to ten minutes old; whether the sun is up is worked out from the times in
    // it rather than read off the `isDay` it was stamped with, which can be on the wrong side of a
    // sunset by then.
    var look = weatherLook(snapshot.code, isDaylight(Date.now()));

    el.weatherIcon.innerHTML = iconMarkup(look.icon);
    el.weatherTemp.textContent = temperature(snapshot.temperatureC);
    el.weatherWord.textContent = look.word;

    // Today is already on the left of the row as the current conditions, so the outlook starts at
    // tomorrow. Four of them; the stylesheet drops the far ones when the header runs out of width.
    el.weatherForecast.innerHTML = (snapshot.days || [])
      .slice(1, 5)
      .map(function (day) {
        return (
          '<div class="forecast-day">' +
          '<span class="forecast-name">' +
          escapeHtml(day.weekday) +
          '</span>' +
          '<span class="weather-icon">' +
          iconMarkup(weatherLook(day.code, true).icon) +
          '</span>' +
          '<span class="forecast-high">' +
          temperature(day.maxC) +
          '</span>' +
          '<span class="forecast-low">' +
          temperature(day.minC) +
          '</span>' +
          '</div>'
        );
      })
      .join('');

    el.weather.hidden = false;
  }

  function fetchWeather() {
    fetch('/vibing-on/weather', { cache: 'no-store' })
      .then(function (response) {
        // Empty body rather than JSON when the feature is off or nothing has been fetched yet.
        return response.ok ? response.text() : '';
      })
      .then(function (body) {
        if (!body || body === 'null') {
          log('weather', 'the server has no snapshot');
          return;
        }

        var snapshot = JSON.parse(body);

        weather.snapshot = snapshot;
        weather.days = snapshot.days && snapshot.days.length ? snapshot.days : null;
        skyAnchors = buildSkyAnchors(weather.days || fallbackDays());

        log('weather', snapshot.temperatureC + '° code ' + snapshot.code + ' at ' + snapshot.timezone);

        paintWeather();
        paintSky(Date.now());
      })
      .catch(function (error) {
        report('weather', 'failed: ' + (error && error.message ? error.message : error));
      });
  }

  // --- the sky -------------------------------------------------------------------------------

  /* Where the background is asked to be at nine moments of the day, as [hue, saturation, lightness].
     The daylight end deliberately stops at a deep blue rather than a real midday sky: the whole page
     is light type on dark, and taking the background past this would mean inverting all of it. */
  var SKY = {
    night: [232, 24, 4],
    dawn: [242, 32, 8],
    sunrise: [18, 40, 16],
    early: [206, 46, 19],
    noon: [205, 52, 26],
    late: [208, 45, 21],
    sunset: [14, 44, 17],
    dusk: [268, 32, 10],
  };

  /* The two dimmest inks were chosen against black and disappear into a lit background, so they are
     mixed towards these as the sky comes up. The bright `--ink` needs no help at either end. */
  var INK_NIGHT = { two: [211, 209, 199], three: [156, 155, 149], four: [95, 94, 90] };
  var INK_DAY = { two: [233, 239, 247], three: [205, 218, 233], four: [168, 186, 208] };

  /** Ordered [{ at, hsl }] covering every day the forecast reached. Rebuilt whenever it arrives. */
  var skyAnchors = [];

  function buildSkyAnchors(days) {
    var anchors = [];

    days.forEach(function (day) {
      if (!day.sunrise || !day.sunset || day.sunset <= day.sunrise) return;

      var noon = (day.sunrise + day.sunset) / 2;

      anchors.push({ at: day.sunrise - 100 * MINUTE_MS, hsl: SKY.night });
      anchors.push({ at: day.sunrise - 55 * MINUTE_MS, hsl: SKY.dawn });
      anchors.push({ at: day.sunrise, hsl: SKY.sunrise });
      anchors.push({ at: day.sunrise + 45 * MINUTE_MS, hsl: SKY.early });
      anchors.push({ at: noon, hsl: SKY.noon });
      anchors.push({ at: day.sunset - 45 * MINUTE_MS, hsl: SKY.late });
      anchors.push({ at: day.sunset, hsl: SKY.sunset });
      anchors.push({ at: day.sunset + 55 * MINUTE_MS, hsl: SKY.dusk });
      anchors.push({ at: day.sunset + 100 * MINUTE_MS, hsl: SKY.night });
    });

    // A short winter day can put the offsets above out of order. Sorting costs nothing and keeps the
    // walk in `sampleSky` honest whatever the latitude.
    return anchors.sort(function (a, b) {
      return a.at - b.at;
    });
  }

  /** Yesterday, today and tomorrow at six and six. Only used when the weather never arrives. */
  function fallbackDays() {
    var days = [];
    var midnight = new Date();

    midnight.setHours(0, 0, 0, 0);

    for (var offset = -1; offset <= 1; offset++) {
      var sunrise = new Date(midnight.getTime());
      var sunset = new Date(midnight.getTime());

      sunrise.setDate(sunrise.getDate() + offset);
      sunrise.setHours(6);
      sunset.setDate(sunset.getDate() + offset);
      sunset.setHours(18);

      days.push({ sunrise: sunrise.getTime(), sunset: sunset.getTime() });
    }

    return days;
  }

  function isDaylight(now) {
    var days = weather.days || fallbackDays();

    for (var i = 0; i < days.length; i++) {
      if (now >= days[i].sunrise && now < days[i].sunset) return true;
    }

    return false;
  }

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  /** Hue takes the short way round the wheel, so dusk does not sweep through green to get to blue. */
  function mixHsl(from, to, ratio) {
    // Smoothstep, so a colour arrives at each anchor rather than cornering at it.
    var t = clamp01(ratio);
    var eased = t * t * (3 - 2 * t);
    var turn = ((((to[0] - from[0]) % 360) + 540) % 360) - 180;

    return [
      (from[0] + turn * eased + 360) % 360,
      from[1] + (to[1] - from[1]) * eased,
      from[2] + (to[2] - from[2]) * eased,
    ];
  }

  function sampleSky(now) {
    if (skyAnchors.length === 0) return SKY.night;
    if (now <= skyAnchors[0].at) return skyAnchors[0].hsl;

    for (var i = 1; i < skyAnchors.length; i++) {
      if (now <= skyAnchors[i].at) {
        var from = skyAnchors[i - 1];
        var to = skyAnchors[i];
        var span = to.at - from.at;

        return span > 0 ? mixHsl(from.hsl, to.hsl, (now - from.at) / span) : to.hsl;
      }
    }

    return skyAnchors[skyAnchors.length - 1].hsl;
  }

  function hsl(h, s, l) {
    return 'hsl(' + Math.round(h) + ' ' + Math.round(clamp01(s / 100) * 100) + '% ' + Math.round(clamp01(l / 100) * 100) + '%)';
  }

  function mixInk(from, to, ratio) {
    var t = clamp01(ratio);

    return (
      'rgb(' +
      Math.round(from[0] + (to[0] - from[0]) * t) +
      ' ' +
      Math.round(from[1] + (to[1] - from[1]) * t) +
      ' ' +
      Math.round(from[2] + (to[2] - from[2]) * t) +
      ')'
    );
  }

  /**
   * One sampled colour, spread over every surface the stylesheet names. Panels and tiles are the
   * same hue a few points lighter rather than colours of their own, which is what keeps the page
   * looking lit from one sky instead of painted in parts.
   */
  function paintSky(now) {
    var base = sampleSky(now);
    var h = base[0];
    var s = base[1];
    var l = base[2];
    var root = document.documentElement.style;

    // The spread of the gradient grows with the light rather than being a fixed number of points:
    // a lit sky wants the depth, and the deep of the night wants to stay the flat black it was.
    root.setProperty('--sky-top', hsl(h, s, l - 2 - l * 0.08));
    root.setProperty('--sky-bottom', hsl(h, s * 0.94, l + 2 + l * 0.16));
    root.setProperty('--bg', hsl(h, s, l));
    root.setProperty('--bg-sunk', hsl(h, s, l - 2));
    root.setProperty('--bg-panel', hsl(h, s * 0.9, l + 4));
    root.setProperty('--bg-tile', hsl(h, s * 0.78, l + 9));
    root.setProperty('--line', hsl(h, s * 0.62, l + 12));

    // How lit the page is, read straight off the colour it just chose rather than off the clock —
    // one number decides both the background and the ink that has to survive it.
    var lift = clamp01((l - SKY.night[2]) / (SKY.noon[2] - SKY.night[2]));

    root.setProperty('--ink-2', mixInk(INK_NIGHT.two, INK_DAY.two, lift));
    root.setProperty('--ink-3', mixInk(INK_NIGHT.three, INK_DAY.three, lift));
    root.setProperty('--ink-4', mixInk(INK_NIGHT.four, INK_DAY.four, lift));
  }

  // --- the tick ------------------------------------------------------------------------------

  /* Landing on the minute boundary rather than every 60000ms from load: a clock that changes eight
     seconds after the minute is a clock somebody will notice is wrong. */
  function tick() {
    paintClock();
    paintSky(Date.now());
    setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
  }

  skyAnchors = buildSkyAnchors(fallbackDays());
  tick();
  fetchWeather();
  setInterval(fetchWeather, WEATHER_REFRESH_MS);

  // Back from a screensaver or a background tab, where timers are throttled to a crawl: the clock
  // could be minutes out and the sky an hour behind.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;

    paintClock();
    paintSky(Date.now());
    paintWeather();
  });

  // -------------------------------------------------------------------------------------------
  // Transport. The buttons never act on their own: every click goes out as `vibing-control` and the
  // player state comes back from the server, so the page cannot disagree with what MPD is doing —
  // including when the disc jockey agent is the one that changed it.
  // -------------------------------------------------------------------------------------------

  var PLAY_ICON = '<path d="M7 4.5 19 12 7 19.5z" />';
  var STOP_ICON = '<rect x="6" y="6" width="12" height="12" rx="1.2" />';
  var CONTROL_TIMEOUT_MS = 5000;

  var playback = { state: 'unknown', pending: false };

  function paintTransport() {
    var playing = playback.state === 'play';
    var reachable = playback.state !== 'unknown' && !playback.pending;
    // Reported by the server as 0 when the queue is empty; undefined means it did not say.
    var queued = playback.queueLength !== 0;

    el.controlToggleIcon.innerHTML = playing ? STOP_ICON : PLAY_ICON;
    el.controlToggle.setAttribute('aria-label', playing ? 'stop' : 'start');
    el.controlToggle.disabled = !reachable || (!playing && !queued);
    el.controlPrevious.disabled = !reachable || !queued;
    el.controlNext.disabled = !reachable || !queued;
  }

  function note(message) {
    el.controlNote.textContent = message || '';
  }

  function applyPlayback(state) {
    if (!state || !state.state) return;

    playback.state = state.state;
    playback.queueLength = state.queueLength;
    paintTransport();

    if (state.state === 'unknown') note('player unreachable');
    else if (state.queueLength === 0) note('queue empty');
    else note('');
  }

  function sendControl(action) {
    if (playback.pending) return;

    if (!socket.connected) {
      report('control', action + ' not sent, the socket is down');
      note('offline');
      return;
    }

    playback.pending = true;
    paintTransport();
    note('…');
    report('control', 'sending ' + action);

    socket.timeout(CONTROL_TIMEOUT_MS).emit('vibing-control', { action: action }, function (error, result) {
      playback.pending = false;

      if (error) {
        report('control', action + ' timed out after ' + CONTROL_TIMEOUT_MS + 'ms');
        note('no answer');
        paintTransport();
        return;
      }

      if (!result || !result.ok) {
        report('control', action + ' refused: ' + ((result && result.error) || 'unknown reason'));
        note('failed');
        paintTransport();
        return;
      }

      report('control', action + ' → ' + ((result.playback && result.playback.state) || 'no state'));
      note('');
      applyPlayback(result.playback);
      paintTransport();
    });
  }

  /**
   * Silent resync on the watchdog tick. The chat agent drives the same player through its own tools,
   * so the toggle can be showing "stop" for a track that was stopped from somewhere else entirely.
   */
  function refreshPlayback() {
    if (!socket.connected || playback.pending) return;

    socket.timeout(CONTROL_TIMEOUT_MS).emit('vibing-control', { action: 'status' }, function (error, result) {
      if (error || !result || !result.ok) {
        log('control', 'status refresh got no usable answer');
        return;
      }

      applyPlayback(result.playback);
    });
  }

  /** A command cannot go anywhere without the socket, so the buttons go down with it. */
  function transportOffline() {
    playback.state = 'unknown';
    playback.pending = false;
    paintTransport();
    note('offline');
  }

  el.controlPrevious.addEventListener('click', function () {
    sendControl('previous');
  });

  el.controlToggle.addEventListener('click', function () {
    // Deliberately not 'play' or 'stop': the server reads the player and picks, so a stale page
    // cannot send the command that matches the state it last happened to see.
    sendControl('toggle');
  });

  el.controlNext.addEventListener('click', function () {
    sendControl('next');
  });

  // -------------------------------------------------------------------------------------------
  // Reactions. The four the Android app sends, counted onto the current play by the same server
  // pipeline. Every viewer sees every reaction, so the television shows what the phones are doing.
  // -------------------------------------------------------------------------------------------

  var REACTION_ART = {
    awesome: '/vibing-on/assets/reactions/love-giraffe.png',
    great: '/vibing-on/assets/reactions/girrafe-sparkle.png',
    duh: '/vibing-on/assets/reactions/arf-giraffe.png',
    wtf: '/vibing-on/assets/reactions/wtf-giraffe.png',
  };

  // Matches the server's own cooldown, so a fast double tap is dropped here rather than sent and
  // refused — what floats up the screen is then exactly what got counted.
  var REACTION_COOLDOWN_MS = 250;
  var lastReactionAt = 0;

  function floatReaction(type) {
    var art = REACTION_ART[type];
    if (!art) return;

    var particle = document.createElement('img');
    particle.className = 'reaction-float';
    particle.src = art;
    particle.alt = '';
    // Spread across the middle of the screen so a burst does not stack into one column.
    particle.style.left = (10 + Math.random() * 75).toFixed(1) + 'vw';
    particle.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';

    particle.addEventListener('animationend', function () {
      particle.remove();
    });

    el.reactionStage.appendChild(particle);
  }

  function sendReaction(type, button) {
    if (!REACTION_ART[type]) return;

    var now = Date.now();
    if (now - lastReactionAt < REACTION_COOLDOWN_MS) return;
    lastReactionAt = now;

    if (!socket.connected) {
      report('reaction', type + ' not sent, the socket is down');
      note('offline');
      return;
    }

    // Floated before the answer comes back: the tap has to feel immediate, and a refusal below
    // only costs a flash on the button.
    floatReaction(type);
    report('reaction', 'sending ' + type);

    socket.timeout(CONTROL_TIMEOUT_MS).emit('vibing-reaction', { reaction: type }, function (error, result) {
      if (error || !result || !result.ok) {
        report('reaction', type + ' not counted: ' + ((result && result.error) || 'no answer'));
        if (button) flashRefused(button);
      }
    });
  }

  function flashRefused(button) {
    button.classList.remove('refused');
    // Forces the animation to restart when the same button is tapped again.
    void button.offsetWidth;
    button.classList.add('refused');
  }

  el.reactions.addEventListener('click', function (event) {
    var button = event.target.closest('.reaction');
    if (!button) return;

    sendReaction(button.getAttribute('data-reaction'), button);
  });

  var socket = io('/vibing', {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  /**
   * The engine is rebuilt on every reconnect, so the transport level listeners have to be reattached
   * each time. This is where a drop is actually explained: `close` carries engine.io's reason, and
   * the ping/pong pair shows whether the tab was still being scheduled at all.
   */
  function traceEngine() {
    var engine = socket.io && socket.io.engine;
    if (!engine || engine.__vibingTraced) return;
    engine.__vibingTraced = true;

    log('engine', 'transport=' + engine.transport.name + ' pingInterval=' + engine.pingInterval + 'ms pingTimeout=' + engine.pingTimeout + 'ms');

    engine.on('upgrade', function () {
      report('engine', 'transport upgraded to ' + engine.transport.name);
    });

    engine.on('close', function (reason) {
      report('engine', 'closed: ' + reason);
    });

    engine.on('error', function (error) {
      report('engine', 'error: ' + (error && error.message ? error.message : error));
    });

    // One line a second at the current server settings — noise, but it is the only way to see a
    // throttled tab miss its pong window.
    engine.on('ping', function () {
      log('engine', 'ping received');
    });

    engine.on('heartbeat', function () {
      log('engine', 'pong sent');
    });
  }

  socket.on('connect', function () {
    setConnected(true, 'live');
    report('socket', 'connected as ' + socket.id + ' via ' + (socket.io.engine && socket.io.engine.transport.name));
    traceEngine();
    heartbeat();
  });

  socket.on('disconnect', function (reason, description) {
    setConnected(false, 'reconnecting');
    transportOffline();
    report('socket', 'disconnected: ' + reason + (description ? ' — ' + description : ''));
  });

  socket.on('connect_error', function (error) {
    setConnected(false, 'reconnecting');
    transportOffline();
    report('socket', 'connect_error: ' + (error && error.message ? error.message : error));
  });

  socket.io.on('reconnect_attempt', function (attempt) {
    log('socket', 'reconnect attempt ' + attempt);
  });

  socket.io.on('reconnect', function (attempt) {
    report('socket', 'reconnected after ' + attempt + ' attempt(s)');
  });

  socket.io.on('reconnect_error', function (error) {
    log('socket', 'reconnect_error: ' + (error && error.message ? error.message : error));
  });

  socket.io.on('reconnect_failed', function () {
    report('socket', 'reconnect gave up');
  });

  /**
   * Every push is addressed and acknowledged per socket on the server side, so the ack has to be
   * called back or the server records the delivery as failed.
   */
  function received(name, describe, handle) {
    return function (payload, ack) {
      report('recv', name + ' ' + describe(payload));
      handle(payload);
      if (typeof ack === 'function') ack({ ok: true, at: Date.now() });
    };
  }

  socket.on(
    'now-playing',
    received('now-playing', function (song) {
      return song && song.songId ? song.songId + ' "' + song.title + '"' : 'empty payload';
    }, apply),
  );

  socket.on(
    'now-playing-commentary',
    received('now-playing-commentary', function (payload) {
      return (payload && payload.songId) + ' (' + ((payload && payload.description) || '').length + ' chars)';
    }, applyCommentary),
  );

  socket.on(
    'now-playing-cover',
    received('now-playing-cover', function (payload) {
      return (payload && payload.songId) + ' ' + (payload && payload.coverUrl);
    }, applyCover),
  );

  socket.on(
    'vibing-playback',
    received('vibing-playback', function (state) {
      return state ? state.state + ' queue=' + state.queueLength : 'empty payload';
    }, applyPlayback),
  );

  // Somebody else reacted. Sent without an ack on purpose, and logged locally only: a busy room
  // would otherwise ship a line to the server for every tap on every phone in it.
  socket.on('vibing-reaction-broadcast', function (payload) {
    if (!payload || !payload.reaction) return;

    log('reaction', 'received ' + payload.reaction);
    floatReaction(payload.reaction);
  });

  /** Application level round trip, so a socket both sides still believe in can be caught not answering. */
  var beat = { sentAt: 0, timer: null };

  function heartbeat() {
    if (!socket.connected) {
      log('heartbeat', 'skipped, socket is down');
      return;
    }

    beat.sentAt = Date.now();
    socket.emit('vibing-ping', beat.sentAt);

    clearTimeout(beat.timer);
    beat.timer = setTimeout(function () {
      report('heartbeat', 'no pong within 5000ms — the socket looks half open');
    }, 5000);
  }

  socket.on('vibing-pong', function () {
    clearTimeout(beat.timer);
    log('heartbeat', 'round trip ' + (Date.now() - beat.sentAt) + 'ms');
  });

  /**
   * Safety net for an unattended display. The websocket carries the same engine ping settings as the
   * chat gateway, which are aggressive enough that a throttled or backgrounded tab gets dropped, and a
   * silently half-open socket would leave the screen showing a track that finished long ago. Polling
   * the snapshot costs a few hundred bytes a minute and `render` ignores anything unchanged.
   */
  function poll() {
    fetch('/vibing-on/now-playing', { cache: 'no-store' })
      .then(function (response) {
        // Empty body rather than JSON when nothing has played yet.
        return response.ok ? response.text() : '';
      })
      .then(function (body) {
        if (!socket.connected) setConnected(false, 'polling');

        if (!body) {
          log('poll', 'server has no snapshot');
          return;
        }

        var song = JSON.parse(body);
        var stale = song.songId !== current.songId;

        // A snapshot the socket never delivered is the symptom this whole trace exists for.
        if (stale) report('poll', 'snapshot differs from the page: ' + song.songId + ' "' + song.title + '" (page has ' + current.songId + ')');
        else log('poll', 'snapshot matches the page');

        apply(song);
      })
      .catch(function (error) {
        if (!socket.connected) setConnected(false, 'offline');
        report('poll', 'failed: ' + (error && error.message ? error.message : error));
      });
  }

  function revive() {
    log('watchdog', 'tick — socket ' + (socket.connected ? 'up (' + socket.id + ')' : 'down'));

    if (!socket.connected) {
      report('watchdog', 'socket is down, reconnecting');
      socket.connect();
    } else {
      heartbeat();
      shipLogs();
      refreshPlayback();
    }

    poll();
  }

  setInterval(revive, 20000);

  // Coming back from a screensaver or a background tab: catch up immediately rather than in 20s.
  document.addEventListener('visibilitychange', function () {
    report('page', document.hidden ? 'hidden' : 'visible');
    if (!document.hidden) revive();
  });

  window.addEventListener('online', function () {
    report('page', 'browser back online');
    revive();
  });

  window.addEventListener('offline', function () {
    report('page', 'browser went offline');
  });

  // `window.vibingDebug.dump()` in the television's console, or ?debug for the on-screen overlay.
  window.vibingDebug = {
    logs: trace.logs,
    socket: socket,
    state: function () {
      return current;
    },
    heartbeat: heartbeat,
    poll: poll,
    playback: function () {
      return playback;
    },
    control: sendControl,
    react: function (type) {
      sendReaction(type);
    },
    dump: function () {
      return trace.logs
        .map(function (entry) {
          return entry.at + ' ' + entry.kind + ': ' + entry.message;
        })
        .join('\n');
    },
  };

  report('page', 'loaded, connecting to /vibing');
})();
