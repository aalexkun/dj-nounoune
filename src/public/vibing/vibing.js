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

  socket.on('connect', function () {
    setConnected(true, 'live');
  });

  socket.on('disconnect', function () {
    setConnected(false, 'reconnecting');
  });

  socket.on('connect_error', function () {
    setConnected(false, 'reconnecting');
  });

  socket.on('now-playing', apply);
  socket.on('now-playing-commentary', applyCommentary);
  socket.on('now-playing-cover', applyCover);

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
        if (body) apply(JSON.parse(body));
      })
      .catch(function () {
        if (!socket.connected) setConnected(false, 'offline');
      });
  }

  function revive() {
    if (!socket.connected) socket.connect();
    poll();
  }

  setInterval(revive, 20000);

  // Coming back from a screensaver or a background tab: catch up immediately rather than in 20s.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) revive();
  });

  window.addEventListener('online', revive);
})();
