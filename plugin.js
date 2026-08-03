/**
 * Lampa Stream Download
 * Кнопка «Скачать» на карточке: источник → озвучка → файл → качество → 1DM/браузер/буфер.
 * Требует установленный Online (Lampac) — component `lampac`.
 *
 * Установка: Настройки → Расширения → добавить URL этого файла (лучше jsDelivr).
 */
(function () {
  'use strict'

  var PLUGIN = 'lampa_stream_download'
  if (window[PLUGIN]) return
  window[PLUGIN] = true

  var COMPONENT = 'lampa_dl'
  var STORAGE_METHOD = 'lampa_dl_method'
  var STORAGE_ENABLE = 'lampa_dl_enable'

  var downloadMode = false
  var downloadArmed = false
  var origPlay = null
  var origPlaylist = null

  var METHODS = [
    { title: '1DM', value: '1dm' },
    { title: '1DM+', value: '1dm_plus' },
    { title: '1DM Lite', value: '1dm_lite' },
    { title: 'ADM', value: 'adm' },
    { title: 'Браузер / системный chooser', value: 'browser' },
    { title: 'Копировать ссылку', value: 'clipboard' },
    { title: 'Спрашивать каждый раз', value: 'ask' }
  ]

  function t(key) {
    return Lampa.Lang.translate(key)
  }

  function pad2(n) {
    n = parseInt(n, 10) || 0
    return (n < 10 ? '0' : '') + n
  }

  function safeName(s) {
    return String(s || 'video')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
  }

  function extForUrl(url) {
    var u = String(url || '').split('?')[0].toLowerCase()
    if (/\.m3u8?$/.test(u) || u.indexOf('.m3u8') !== -1) return 'ts'
    if (/\.mkv$/.test(u)) return 'mkv'
    if (/\.webm$/.test(u)) return 'webm'
    if (/\.avi$/.test(u)) return 'avi'
    return 'mp4'
  }

  function isHls(url) {
    var u = String(url || '').toLowerCase()
    return u.indexOf('.m3u8') !== -1 || u.indexOf('m3u8') !== -1
  }

  function buildFilename(meta, qualityLabel, url) {
    var parts = [safeName(meta.title || meta.name || 'video')]
    if (meta.season) parts.push('S' + pad2(meta.season) + 'E' + pad2(meta.episode || 0))
    if (meta.voice_name) parts.push(safeName(meta.voice_name))
    if (qualityLabel) parts.push(safeName(qualityLabel))
    return parts.join('.') + '.' + extForUrl(url)
  }

  function getMethod() {
    return Lampa.Storage.get(STORAGE_METHOD, '1dm')
  }

  function methodTitle(value) {
    for (var i = 0; i < METHODS.length; i++) {
      if (METHODS[i].value === value) return METHODS[i].title
    }
    return value
  }

  function encodeIntent(url) {
    // В data-части intent нельзя оставлять сырой # — иначе обрежется fragment Intent
    return String(url || '').replace(/#/g, '%23')
  }

  function openAndroid(url) {
    if (Lampa.Android && typeof Lampa.Android.openBrowser === 'function') {
      Lampa.Android.openBrowser(url)
      return true
    }
    try {
      window.location.href = url
      return true
    } catch (e) {
      return false
    }
  }

  function sendTo1dm(pkg, url, filename, headers) {
    var intent =
      'intent:' +
      encodeIntent(url) +
      '#Intent;' +
      'package=' +
      pkg +
      ';' +
      'scheme=idmdownload;' +
      'S.title=' +
      encodeURIComponent(filename) +
      ';'

    if (headers && typeof headers === 'object') {
      // Limited support via query is unreliable; title is enough for most Lampac proxy URLs
      var ua = headers['User-Agent'] || headers['user-agent']
      var ref = headers['Referer'] || headers['referer']
      if (ua) intent += 'S.extra_useragent=' + encodeURIComponent(ua) + ';'
      if (ref) intent += 'S.extra_referer=' + encodeURIComponent(ref) + ';'
    }

    intent += 'end'
    return openAndroid(intent)
  }

  function sendToAdm(url, filename) {
    // ADM accepts VIEW on the URL; package hint via intent
    var intent =
      'intent:' +
      encodeIntent(url) +
      '#Intent;' +
      'package=com.dv.adm;' +
      'S.filename=' +
      encodeURIComponent(filename) +
      ';' +
      'end'
    if (!openAndroid(intent)) {
      return openAndroid(url)
    }
    return true
  }

  function copyLink(url) {
    Lampa.Utils.copyTextToClipboard(
      url,
      function () {
        Lampa.Noty.show(t('lampa_dl_copied'))
      },
      function () {
        Lampa.Noty.show(t('lampa_dl_copy_fail'))
      }
    )
  }

  function launchDownload(url, filename, headers, method) {
    method = method || getMethod()

    if (!url) {
      Lampa.Noty.show(t('lampa_dl_nolink'))
      return
    }

    if (method === 'clipboard') {
      copyLink(url)
      return
    }

    if (method === 'browser') {
      if (!openAndroid(url)) copyLink(url)
      else Lampa.Noty.show(t('lampa_dl_sent_browser'))
      return
    }

    if (!Lampa.Platform.is('android')) {
      Lampa.Noty.show(t('lampa_dl_android_only'))
      copyLink(url)
      return
    }

    var ok = false
    if (method === '1dm') ok = sendTo1dm('idm.internet.download.manager', url, filename, headers)
    else if (method === '1dm_plus') ok = sendTo1dm('idm.internet.download.manager.plus', url, filename, headers)
    else if (method === '1dm_lite') ok = sendTo1dm('idm.internet.download.manager.adm.lite', url, filename, headers)
    else if (method === 'adm') ok = sendToAdm(url, filename)
    else ok = openAndroid(url)

    if (ok) {
      var msg = isHls(url) ? t('lampa_dl_sent_hls') : t('lampa_dl_sent')
      Lampa.Noty.show(msg)
    } else {
      copyLink(url)
    }
  }

  function pickMethodThenLaunch(url, filename, headers) {
    var method = getMethod()
    if (method !== 'ask') {
      launchDownload(url, filename, headers, method)
      return
    }

    var items = METHODS.filter(function (m) {
      return m.value !== 'ask'
    }).map(function (m) {
      return { title: m.title, value: m.value }
    })

    Lampa.Select.show({
      title: t('lampa_dl_method'),
      items: items,
      onBack: function () {
        Lampa.Controller.toggle('content')
      },
      onSelect: function (a) {
        Lampa.Controller.toggle('content')
        launchDownload(url, filename, headers, a.value)
      }
    })
  }

  function normalizeQualityMap(quality) {
    var map = {}
    if (!quality || typeof quality !== 'object') return map
    for (var k in quality) {
      if (!Object.prototype.hasOwnProperty.call(quality, k)) continue
      var v = quality[k]
      if (!v) continue
      if (typeof v === 'string' && v.indexOf(' or ') !== -1) v = v.split(' or ')[0]
      map[k] = v
    }
    return map
  }

  function pickQuality(data, done) {
    var map = normalizeQualityMap(data.quality)
    var keys = Lampa.Arrays.getKeys(map)

    if (!keys.length) {
      done(data.url, '')
      return
    }

    if (keys.length === 1) {
      done(map[keys[0]] || data.url, keys[0])
      return
    }

    var items = keys.map(function (k) {
      return {
        title: k + (isHls(map[k]) ? '  · HLS' : ''),
        url: map[k],
        quality: k,
        selected: data.url === map[k]
      }
    })

    Lampa.Select.show({
      title: t('lampa_dl_quality'),
      items: items,
      onBack: function () {
        Lampa.Controller.toggle('content')
      },
      onSelect: function (a) {
        Lampa.Controller.toggle('content')
        done(a.url, a.quality)
      }
    })
  }

  function movieFromContext() {
    var act = Lampa.Activity.active() || {}
    return act.movie || act.card || {}
  }

  function disarmDownload() {
    downloadMode = false
    downloadArmed = false
  }

  function handlePlayData(data) {
    disarmDownload()

    var movie = movieFromContext()
    var meta = {
      title: (data && data.title) || movie.title || movie.name || movie.original_title,
      name: movie.name,
      season: data && data.season,
      episode: data && data.episode,
      voice_name: (data && data.voice_name) || ''
    }

    pickQuality(data || {}, function (url, qualityLabel) {
      if (!url) {
        Lampa.Noty.show(t('lampa_dl_nolink'))
        return
      }
      var filename = buildFilename(meta, qualityLabel, url)
      pickMethodThenLaunch(url, filename, data && data.headers)
    })
  }

  function handleExtraDownload(extra, params) {
    var element = (params && params.element) || {}
    var movie = movieFromContext()
    var data = {
      title: element.title || movie.title || movie.name,
      url: (extra && (extra.file || extra.url)) || element.url,
      quality: (extra && extra.quality) || element.qualitys || element.quality,
      headers: (extra && extra.headers) || element.headers,
      season: element.season,
      episode: element.episode,
      voice_name: element.voice_name || element.translate_voice || ''
    }
    handlePlayData(data)
  }

  function patchPlayer() {
    if (origPlay) return
    origPlay = Lampa.Player.play
    origPlaylist = Lampa.Player.playlist

    Lampa.Player.play = function (data) {
      if (downloadMode) {
        handlePlayData(data)
        return
      }
      return origPlay.apply(Lampa.Player, arguments)
    }

    Lampa.Player.playlist = function (list) {
      if (downloadMode) return
      return origPlaylist.apply(Lampa.Player, arguments)
    }
  }

  function hasOnlineComponent() {
    try {
      return Boolean(Lampa.Component.get('lampac'))
    } catch (e) {
      return false
    }
  }

  function openDownloadPicker(movie) {
    if (!hasOnlineComponent()) {
      Lampa.Noty.show(t('lampa_dl_need_online'))
      return
    }

    downloadMode = true
    downloadArmed = true

    var id = Lampa.Utils.hash(movie.number_of_seasons ? movie.original_name : movie.original_title)
    var all = Lampa.Storage.get('clarification_search', '{}')

    Lampa.Activity.push({
      url: '',
      title: t('lampa_dl_title'),
      component: 'lampac',
      search: all[id] ? all[id] : movie.title || movie.name,
      search_one: movie.title || movie.name,
      search_two: movie.original_title || movie.original_name,
      movie: movie,
      page: 1,
      clarification: all[id] ? true : false
    })
  }

  function isButtonEnabled() {
    var v = Lampa.Storage.get(STORAGE_ENABLE, true)
    return !(v === false || v === 'false' || v === 0 || v === '0')
  }

  function addCardButton(e) {
    if (!isButtonEnabled()) return
    if (!e.render || !e.render.length) return
    if (e.render.find('.lampa-dl--button').length) return

    var btn = $(
      [
        '<div class="full-start__button selector view--online lampa-dl--button">',
        '  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">',
        '    <path d="M5 20h14v-2H5v2zm7-18v10.17l3.59-3.58L17 10l-5 5-5-5 1.41-1.41L11 12.17V2h1z"/>',
        '  </svg>',
        '  <span>' + t('lampa_dl_btn') + '</span>',
        '</div>'
      ].join('')
    )

    btn.on('hover:enter', function () {
      openDownloadPicker(e.movie)
    })

    e.render.after(btn)
  }

  function hookOnlineContextMenu() {
    var prev = window.lampac_online_context_menu

    window.lampac_online_context_menu = {
      push: function (menu, extra, params) {
        if (prev && typeof prev.push === 'function') prev.push(menu, extra, params)
        menu.push({
          title: t('lampa_dl_btn'),
          lampa_dl: true,
          _extra: extra,
          _params: params
        })
      },
      onSelect: function (a, params) {
        if (prev && typeof prev.onSelect === 'function') prev.onSelect(a, params)
        if (a && a.lampa_dl) handleExtraDownload(a._extra, a._params || params)
      }
    }
  }

  function addSettings() {
    Lampa.SettingsApi.addComponent({
      component: COMPONENT,
      name: t('lampa_dl_settings'),
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5 20h14v-2H5v2zm7-18v10.17l3.59-3.58L17 10l-5 5-5-5 1.41-1.41L11 12.17V2h1z"/></svg>'
    })

    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        name: STORAGE_ENABLE,
        type: 'trigger',
        default: true
      },
      field: {
        name: t('lampa_dl_enable'),
        description: t('lampa_dl_enable_desc')
      }
    })

    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        name: STORAGE_METHOD,
        type: 'select',
        values: (function () {
          var o = {}
          METHODS.forEach(function (m) {
            o[m.value] = m.title
          })
          return o
        })(),
        default: '1dm'
      },
      field: {
        name: t('lampa_dl_method'),
        description: t('lampa_dl_method_desc')
      },
      onChange: function () {
        Lampa.Noty.show(methodTitle(getMethod()))
      }
    })
  }

  function addLang() {
    Lampa.Lang.add({
      lampa_dl_settings: {
        ru: 'Скачивание',
        en: 'Download',
        uk: 'Завантаження'
      },
      lampa_dl_btn: {
        ru: 'Скачать',
        en: 'Download',
        uk: 'Завантажити'
      },
      lampa_dl_title: {
        ru: 'Скачать',
        en: 'Download',
        uk: 'Завантажити'
      },
      lampa_dl_enable: {
        ru: 'Кнопка на карточке',
        en: 'Button on card',
        uk: 'Кнопка на картці'
      },
      lampa_dl_enable_desc: {
        ru: 'Показывать «Скачать» рядом с Онлайн',
        en: 'Show Download next to Online',
        uk: 'Показувати «Завантажити» поруч з Онлайн'
      },
      lampa_dl_method: {
        ru: 'Куда отдавать ссылку',
        en: 'Download target',
        uk: 'Куди віддавати посилання'
      },
      lampa_dl_method_desc: {
        ru: 'На Android лучше 1DM — он умеет m3u8 и склеивает сегменты',
        en: 'On Android prefer 1DM — it can merge m3u8 segments',
        uk: 'На Android краще 1DM — вміє m3u8 і склеює сегменти'
      },
      lampa_dl_quality: {
        ru: 'Качество',
        en: 'Quality',
        uk: 'Якість'
      },
      lampa_dl_need_online: {
        ru: 'Нужен плагин Online (Lampac)',
        en: 'Online (Lampac) plugin required',
        uk: 'Потрібен плагін Online (Lampac)'
      },
      lampa_dl_nolink: {
        ru: 'Нет ссылки на файл',
        en: 'No media URL',
        uk: 'Немає посилання на файл'
      },
      lampa_dl_android_only: {
        ru: 'Скачивание через 1DM — только Android. Ссылка скопирована.',
        en: '1DM download is Android-only. Link copied.',
        uk: 'Завантаження через 1DM — лише Android. Посилання скопійовано.'
      },
      lampa_dl_sent: {
        ru: 'Отправлено в загрузчик',
        en: 'Sent to downloader',
        uk: 'Надіслано в завантажувач'
      },
      lampa_dl_sent_hls: {
        ru: 'HLS (m3u8) отправлен в 1DM — дождитесь склейки сегментов',
        en: 'HLS sent to 1DM — wait for segment merge',
        uk: 'HLS надіслано в 1DM — дочекайтесь склеювання'
      },
      lampa_dl_sent_browser: {
        ru: 'Открыто в системном приложении',
        en: 'Opened in system app',
        uk: 'Відкрито в системному застосунку'
      },
      lampa_dl_copied: {
        ru: 'Ссылка скопирована',
        en: 'Link copied',
        uk: 'Посилання скопійовано'
      },
      lampa_dl_copy_fail: {
        ru: 'Не удалось скопировать',
        en: 'Copy failed',
        uk: 'Не вдалося скопіювати'
      }
    })
  }

  function start() {
    addLang()
    addSettings()
    patchPlayer()
    hookOnlineContextMenu()

    Lampa.Listener.follow('full', function (e) {
      if (e.type !== 'complite') return
      addCardButton({
        render: e.object.activity.render().find('.view--torrent'),
        movie: e.data.movie
      })
    })

    try {
      if (Lampa.Activity.active().component === 'full') {
        addCardButton({
          render: Lampa.Activity.active().activity.render().find('.view--torrent'),
          movie: Lampa.Activity.active().card
        })
      }
    } catch (e) {}

    // Сброс, если вышли из выбора Online без выбора файла
    if (Lampa.Activity && Lampa.Activity.listener) {
      Lampa.Activity.listener.follow('destroy', function () {
        if (!downloadArmed) return
        setTimeout(function () {
          if (downloadMode) disarmDownload()
        }, 400)
      })
    }
  }

  if (window.appready) start()
  else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') start()
    })
  }
})()
