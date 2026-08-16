(function () {
  'use strict';

  var el = {
    dot: document.getElementById('live-dot'),
    status: document.getElementById('rail-status'),
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

  function setCover(url) {
    if (!url) {
      el.cover.hidden = true;
      el.cover.removeAttribute('src');
      el.coverPlaceholder.hidden = false;
      return;
    }
    el.cover.src = url;
    el.cover.hidden = false;
    el.coverPlaceholder.hidden = true;
  }

  el.cover.addEventListener('error', function () {
    // Discogs' CDN blocks hotlinking, so a resolved URL can still fail to load.
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

    // Roughly a line per second, whatever the display scales the text to.
    var pixelsPerSecond = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.01;
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

  window.addEventListener('resize', driftNarration);

  function setConnected(connected, label) {
    el.dot.className = connected ? 'dot' : 'dot offline';
    el.status.textContent = label;
  }

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
    report('socket', 'disconnected: ' + reason + (description ? ' — ' + description : ''));
  });

  socket.on('connect_error', function (error) {
    setConnected(false, 'reconnecting');
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
