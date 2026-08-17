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

  function renderBadges(song) {
    var badges = [];

    if (song.isHighRes && song.bitDepth && song.sampleRate) {
      badges.push({ text: 'hi-res ' + song.bitDepth + '/' + Math.round(song.sampleRate / 1000), accent: true });
    } else if (song.isHighRes) {
      badges.push({ text: 'hi-res', accent: true });
    }
    if (song.encoding) badges.push({ text: String(song.encoding).toLowerCase() });
    if (song.sourceName) badges.push({ text: song.sourceName });
    if (song.bpm) badges.push({ text: Math.round(song.bpm) + ' bpm' });
    var duration = formatDuration(song.duration);
    if (duration) badges.push({ text: duration });

    el.badges.innerHTML = badges
      .map(function (badge) {
        return '<span class="badge' + (badge.accent ? ' accent' : '') + '">' + escapeHtml(badge.text) + '</span>';
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

  /**
   * The commentary is usually taller than its column, and nobody scrolls a television. So once a
   * track settles, walk the narration down at reading pace, hold at the end, and start over.
   */
  function driftNarration() {
    var node = el.narration;

    if (drift) {
      cancelAnimationFrame(drift.frame);
      clearTimeout(drift.timer);
      drift = null;
    }

    node.scrollTop = 0;

    if (node.scrollHeight <= node.clientHeight + 4) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Roughly a line every two seconds, whatever the display scales the text to.
    var pixelsPerSecond = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.505;
    var HOLD_MS = 8000;
    var state = { frame: 0, timer: 0 };
    var offset = 0;
    drift = state;

    function step(previous) {
      return function (now) {
        // Kept in a variable rather than read back off scrollTop, which rounds sub-pixel steps away.
        offset += (pixelsPerSecond * (now - previous)) / 1000;
        node.scrollTop = offset;

        if (offset + node.clientHeight >= node.scrollHeight - 1) {
          state.timer = setTimeout(function () {
            offset = 0;
            node.scrollTop = 0;
            state.timer = setTimeout(begin, HOLD_MS);
          }, HOLD_MS);
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

    state.timer = setTimeout(begin, HOLD_MS);
  }

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
