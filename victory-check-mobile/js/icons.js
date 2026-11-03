/**
 * Иконки дизайн-системы ОТ (stroke 1.7, round cap/join, 24×24).
 */
(function (global) {
  const STROKE = 1.7;

  function paths(name) {
    const p = {
      goggles:
        '<circle cx="7.5" cy="13" r="3.3"/><circle cx="16.5" cy="13" r="3.3"/><path d="M10.8 12.6a2.2 2.2 0 0 1 2.4 0"/><path d="M4.4 11 6 8.4a1.6 1.6 0 0 1 1.4-.8h9.2A1.6 1.6 0 0 1 18 8.4L19.6 11"/>',
      bolt: '<path d="M13 2 5 13h6l-1 9 8-11h-6l1-9Z"/>',
      culture:
        '<path d="M8.5 12.5 11 15l5-5.5"/><path d="M12 2.6 4 6v6.2c0 4.6 3.3 7.4 8 9.2 4.7-1.8 8-4.6 8-9.2V6z"/>',
      doc:
        '<path d="M13 3H6.5v18h11V8.5z"/><path d="M13 3v5.5h4.5"/><path d="M9.5 13.5h5"/><path d="M9.5 16.5h5"/>',
      crane:
        '<path d="M6 21V7"/><path d="M3.5 21h5"/><path d="M3 7h17.5"/><path d="M6 7 8 3.5 10 7"/><path d="M8 3.5 18.5 7"/><path d="M16 7v3.4"/><path d="M14.9 10.4a1.1 1.1 0 0 0 2.2 0"/>',
      ladder:
        '<path d="M8 3v18M16 3v18M8 7h8M8 12h8M8 17h8"/>',
      flame:
        '<path d="M12 3c2.5 3.2 4.5 5.3 4.5 8.5a4.5 4.5 0 0 1-9 0c0-1.3.5-2.3 1.3-3.2.4 1.2 1.2 1.7 1.9 1.7-.6-2 .3-4.7 1.3-6.8z"/>',
      other: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
      hazard:
        '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17.5h.01"/>',
      drop: '<path d="M12 3c-4 5.5-6 8.5-6 12a6 6 0 0 0 12 0c0-3.5-2-6.5-6-12Z"/>',
      hearing:
        '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14a2 2 0 0 0 2 2h1v3H5a3 3 0 0 1-3-3v-2M20 14a2 2 0 0 1-2 2h-1v3h2a3 3 0 0 0 3-3v-2"/>',
      load: '<path d="M12 3 4 8v8l8 5 8-5V8l-8-5Z"/><path d="M12 12 4 8M12 12l8-4M12 12v10"/>',
      permit:
        '<path d="M8 3h8l2 3v15H6V6l2-3Z"/><path d="M9 11h6M9 15h6"/>',
      gear:
        '<circle cx="12" cy="12" r="3"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
      camera:
        '<path d="M4 8h3l1.5-2h7L17 8h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="14" r="3.5"/>',
      add: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
      user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
      pin: '<path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z"/><circle cx="12" cy="11" r="2"/>',
      calendar:
        '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
      comment:
        '<path d="M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 3V7a2 2 0 0 1 2-2Z"/><path d="M8 10h8M8 14h5"/>',
      filter:
        '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
      export:
        '<path d="M8 4h8v12H8z"/><path d="M12 8v9M9.5 14.5 12 17l2.5-2.5"/>',
      edit: '<path d="M4 18h4l9.5-9.5a2.1 2.1 0 0 0-3-3L5 15v3Z"/><path d="M13.5 6.5l3 3"/>',
      attach:
        '<path d="M8 12.5a4.5 4.5 0 0 0 6.4 6.4l4.6-4.6a3 3 0 0 0-4.2-4.2l-5 5a1.5 1.5 0 1 0 2.1 2.1l4.7-4.7"/>',
      clipboard:
        '<rect x="7" y="4" width="10" height="17" rx="2"/><path d="M9 4.5h6a2 2 0 0 1 2 2v1H7v-1a2 2 0 0 1 2-2Z"/><path d="M9 11h6M9 15h4"/>',
      chart:
        '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      profile:
        '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
      search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l5 5"/>',
      building:
        '<path d="M4 20V8l8-4 8 4v12"/><path d="M9 20v-6h6v6M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/>',
      check:
        '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/>',
      clock:
        '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      alert:
        '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
      devices:
        '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
      home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>',
      org: '<rect x="4" y="8" width="16" height="13" rx="1"/><path d="M8 8V5h8v3M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/>',
      bell:
        '<path d="M12 3a5 5 0 0 0-5 5v4l-2 3h14l-2-3V8a5 5 0 0 0-5-5Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
      chevron: '<path d="M9 6l6 6-6 6"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
      moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z"/>',
    };
    return p[name] || p.clipboard;
  }

  const CATEGORY_MAP = {
    ppe: 'goggles',
    electro: 'bolt',
    height: 'ladder',
    fire: 'flame',
    culture: 'culture',
    doc: 'doc',
    load: 'load',
    machinery: 'crane',
    other: 'other',
    hazard: 'hazard',
    gas: 'drop',
    noise: 'hearing',
    permit: 'permit',
    ground: 'hazard',
    scaffold: 'ladder',
  };

  function svg(name, opts = {}) {
    const size = opts.size || 24;
    const cls = opts.className ? ` class="${opts.className}"` : '';
    const body = paths(name);
    return `<svg${cls} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  function categoryIcon(categoryId, opts = {}) {
    const key = CATEGORY_MAP[categoryId] || 'permit';
    return svg(key, { ...opts, className: (opts.className || '') + ' vc-cat-icon' });
  }

  function categoryIconId(categoryId) {
    return CATEGORY_MAP[categoryId] || 'permit';
  }

  global.VCIcons = { svg, categoryIcon, categoryIconId, CATEGORY_MAP };
})(typeof window !== 'undefined' ? window : global);
