/* ============================================================
   constructor.js — логика конструктора футболок «Отпечаток»
   Использует Fabric.js для работы с Canvas.
   У футболки две стороны (перед и спина): у каждой свой Canvas
   и свой дизайн, они хранятся независимо друг от друга.
   ============================================================ */

(function () {
  'use strict';

  // ── Константы размеров канваса ───────────────────────────────────────────
  const CANVAS_W = 500;
  const CANVAS_H = 560;

  // Ограничения на загружаемый файл
  const MAX_FILE_BYTES = 25 * 1024 * 1024;   // 25 МБ
  const MAX_IMG_W      = 3508;               // A3 при 300 DPI: 297 мм
  const MAX_IMG_H      = 4961;               // A3 при 300 DPI: 420 мм

  // Зона печати на футболке — лист A3 (297×420 мм), стоящий вертикально.
  const ZONE_H = CANVAS_H * 0.48;
  const ZONE_W = ZONE_H * (MAX_IMG_W / MAX_IMG_H);
  const PRINT_ZONE = {
    x: (CANVAS_W - ZONE_W) / 2,
    y: CANVAS_H * 0.27,
    w: ZONE_W,
    h: ZONE_H,
  };

  const ZONE_EPS = 0.5;

  const ZONE_COLOR       = 'rgba(204,255,0,0.9)';
  const ZONE_ALERT_COLOR = '#ff4d4f';

  const MIN_SCALE_PCT = 10;
  const MAX_SCALE_PCT = 100;

  const EXPORT_SCALE = 2;

  const SIDE_LABELS = { front: 'перед', back: 'спина' };

  // ── Состояние приложения ──────────────────────────────────────────────────
  const state = {
    color:      '#f8fafc',
    colorName:  'Белый',
    size:       'M',
    activeSide: 'front',
  };

  // ── Ссылки на DOM-элементы ────────────────────────────────────────────────
  const canvasWrapper  = document.getElementById('canvas-wrapper');
  const uploadZone     = document.getElementById('upload-zone');
  const uploadError    = document.getElementById('upload-error');
  const uploadSideEl   = document.getElementById('upload-side-label');
  const imageInput     = document.getElementById('image-input');
  const imageControls  = document.getElementById('image-controls');
  const scaleSlider    = document.getElementById('scale-slider');
  const scaleValue     = document.getElementById('scale-value');
  const centerBtn      = document.getElementById('center-btn');
  const removeBtn      = document.getElementById('remove-image-btn');
  const orderBtn       = document.getElementById('order-btn');
  const canvasHint     = document.getElementById('canvas-hint');
  const colorNameEl    = document.getElementById('selected-color-name');
  const sideButtons    = document.querySelectorAll('.side-btn');

  // ── Создание одной стороны футболки (отдельный Fabric-канвас) ────────────
  function createSide(key, canvasId, containerId) {
    const canvas = new fabric.Canvas(canvasId, {
      width:                  CANVAS_W,
      height:                 CANVAS_H,
      selection:              false,
      preserveObjectStacking: true,
      uniScaleKey:            null,
    });

    const side = {
      key:       key,
      canvas:    canvas,
      container: document.getElementById(containerId),
      imageObj:  null,
      fitScale:  1,
      scalePct:  100,
      zoneRect:  null,
    };

    function onSelect(obj) {
      if (obj && obj._isUserImage) {
        side.imageObj = obj;
        side.fitScale = obj._fitScale || side.fitScale;
        side.scalePct = Math.round(obj.scaleX / side.fitScale * 100);
      } else {
        side.imageObj = null;
      }
      if (side === current()) syncControls();
    }
    canvas.on('selection:created', function (opt) { onSelect(opt.selected && opt.selected[0]); });
    canvas.on('selection:updated', function (opt) { onSelect(opt.selected && opt.selected[0]); });
    canvas.on('selection:cleared', function ()    { side.imageObj = null; if (side === current()) syncControls(); });

    return side;
  }

  const sides = {
    front: createSide('front', 'canvas-front', 'side-front'),
    back:  createSide('back',  'canvas-back',  'side-back'),
  };

  function current() {
    return sides[state.activeSide];
  }

  // ── Рисуем футболку на нижнем слое ──────────────────────────────────────
  function drawTshirt(side, color) {
    const fc = side.canvas;

    fc.getObjects().filter(o => o._isTshirt).forEach(o => fc.remove(o));

    const strokeColor = darkenHex(color, 25);

    fc.setBackgroundColor('#161616', fc.renderAll.bind(fc));

    const W = CANVAS_W;
    const H = CANVAS_H;

    const neckY = side.key === 'front' ? 0.19 : 0.13;

    const tshirtPath = new fabric.Path(
      `M ${W*0.30} ${H*0.10}
       L ${W*0.05} ${H*0.30}
       L ${W*0.18} ${H*0.37}
       L ${W*0.16} ${H*0.88}
       L ${W*0.84} ${H*0.88}
       L ${W*0.82} ${H*0.37}
       L ${W*0.95} ${H*0.30}
       L ${W*0.70} ${H*0.10}
       Q ${W*0.58} ${H*neckY} ${W*0.50} ${H*neckY}
       Q ${W*0.42} ${H*neckY} ${W*0.30} ${H*0.10}
       Z`,
      {
        fill:        color,
        stroke:      strokeColor,
        strokeWidth: 2,
        selectable:  false,
        evented:     false,
        _isTshirt:   true,
        shadow:      new fabric.Shadow({
          color:   'rgba(0,0,0,0.55)',
          blur:    20,
          offsetX: 0,
          offsetY: 8,
        }),
      }
    );

    fc.insertAt(tshirtPath, 0);

    const sideLabel = new fabric.Text(side.key === 'front' ? 'ПЕРЕД' : 'СПИНА', {
      left:       W / 2,
      top:        H * 0.94,
      originX:    'center',
      originY:    'center',
      fontFamily: 'Inter, Segoe UI, sans-serif',
      fontSize:   14,
      fontWeight: 700,
      charSpacing: 300,
      fill:       'rgba(255,255,255,0.35)',
      selectable: false,
      evented:    false,
      _isTshirt:  true,
    });
    fc.insertAt(sideLabel, 1);

    const zoneProps = {
      left:          PRINT_ZONE.x,
      top:           PRINT_ZONE.y,
      width:         PRINT_ZONE.w,
      height:        PRINT_ZONE.h,
      fill:          'transparent',
      strokeWidth:   1.5,
      strokeUniform: true,
      selectable:    false,
      evented:       false,
      _isTshirt:     true,
      _isPrintZone:  true,
    };

    const printZoneUnderlay = new fabric.Rect(Object.assign({}, zoneProps, {
      stroke: 'rgba(0,0,0,0.35)',
    }));

    const printZoneRect = new fabric.Rect(Object.assign({}, zoneProps, {
      stroke:          ZONE_COLOR,
      strokeDashArray: [6, 4],
    }));

    const printZoneLabel = new fabric.Text('Зона печати A3', {
      left:            PRINT_ZONE.x + PRINT_ZONE.w / 2,
      top:             PRINT_ZONE.y + PRINT_ZONE.h + 12,
      originX:         'center',
      originY:         'center',
      fontFamily:      'Inter, Segoe UI, sans-serif',
      fontSize:        11,
      fontWeight:      600,
      fill:            ZONE_COLOR,
      backgroundColor: 'rgba(10,10,10,0.65)',
      padding:         3,
      selectable:      false,
      evented:         false,
      _isTshirt:       true,
      _isPrintZone:    true,
    });

    fc.insertAt(printZoneUnderlay, 2);
    fc.insertAt(printZoneRect, 3);
    fc.insertAt(printZoneLabel, 4);
    side.zoneRect = printZoneRect;
    fc.renderAll();
  }

  function setZoneAlert(side, isAlert) {
    // clipPath сам показывает, что вышло за зону — подсветка отключена
  }

  function darkenHex(hex, amount) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = Math.max(0, parseInt(hex.slice(0, 2), 16) - amount);
    const g = Math.max(0, parseInt(hex.slice(2, 4), 16) - amount);
    const b = Math.max(0, parseInt(hex.slice(4, 6), 16) - amount);
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function minScale(side) { return side.fitScale * MIN_SCALE_PCT / 100; }
  function maxScale(side) { return side.fitScale * MAX_SCALE_PCT / 100; }

  function constrainImage(side, img) {
    img.on('scaling', function () {
      const pct = Math.round(img.scaleX / (img._fitScale || side.fitScale) * 100);
      side.scalePct = pct;
      if (side === current()) syncControls();
    });

    img.on('modified', function () {
      img.setCoords();
    });
  }

  function isInsidePrintZone(side) {
    const img = side.imageObj;
    if (!img) return true;
    if (img.clipPath) return true;

    const r = img.getBoundingRect(true, true);
    return r.left >= PRINT_ZONE.x - ZONE_EPS &&
           r.top  >= PRINT_ZONE.y - ZONE_EPS &&
           r.left + r.width  <= PRINT_ZONE.x + PRINT_ZONE.w + ZONE_EPS &&
           r.top  + r.height <= PRINT_ZONE.y + PRINT_ZONE.h + ZONE_EPS;
  }

  function showUploadError(text) {
    uploadError.textContent = text;
    uploadError.hidden = false;
  }

  function hideUploadError() {
    uploadError.hidden = true;
    uploadError.textContent = '';
  }

  function loadImage(file) {
    hideUploadError();

    if (!file || !file.type.startsWith('image/')) {
      showUploadError('Пожалуйста, выберите файл изображения (PNG, JPG, GIF).');
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      showUploadError('Файл слишком большой. Максимальный размер — 25 МБ.');
      return;
    }

    const side = current();
    const reader = new FileReader();

    reader.onload = function (e) {
      const imgEl = new Image();

      imgEl.onload = function () {
        const w = imgEl.naturalWidth;
        const h = imgEl.naturalHeight;

        if (w > MAX_IMG_W || h > MAX_IMG_H) {
          showUploadError(
            `Изображение слишком большое: ${w}×${h} px. ` +
            `Максимум — ${MAX_IMG_W}×${MAX_IMG_H} px (формат A3 при 300 DPI). ` +
            'Уменьшите изображение и загрузите снова.'
          );
          return;
        }

        placeImage(side, imgEl);
      };

      imgEl.onerror = function () {
        showUploadError('Не удалось прочитать изображение. Попробуйте другой файл.');
      };

      imgEl.src = e.target.result;
    };

    reader.onerror = function () {
      showUploadError('Не удалось прочитать файл. Попробуйте ещё раз.');
    };

    reader.readAsDataURL(file);
  }

  function placeImage(side, imgEl) {
    const img = new fabric.Image(imgEl);

    side.fitScale = Math.min(PRINT_ZONE.w / img.width, PRINT_ZONE.h / img.height);
    img._fitScale = side.fitScale;
    const scale = Math.min(Math.max(Math.min(side.fitScale * 0.85, 1), minScale(side)), maxScale(side));

    img.clipPath = new fabric.Rect({
      left:               PRINT_ZONE.x,
      top:                PRINT_ZONE.y,
      width:              PRINT_ZONE.w,
      height:             PRINT_ZONE.h,
      absolutePositioned: true,
    });

    img.set({
      left:               PRINT_ZONE.x + PRINT_ZONE.w / 2,
      top:                PRINT_ZONE.y + PRINT_ZONE.h / 2,
      originX:            'center',
      originY:            'center',
      scaleX:             scale,
      scaleY:             scale,
      objectCaching:      true,
      hasControls:        true,
      hasBorders:         true,
      cornerStyle:        'circle',
      cornerColor:        '#ccff00',
      cornerStrokeColor:  '#0a0a0a',
      transparentCorners: false,
      cornerSize:         10,
      lockRotation:       false,
      lockScalingFlip:    true,
      lockSkewingX:       true,
      lockSkewingY:       true,
      _isUserImage:       true,
    });
    img.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });

    constrainImage(side, img);

    side.canvas.add(img);
    side.canvas.setActiveObject(img);
    side.canvas.renderAll();

    side.imageObj  = img;
    side.scalePct  = Math.round(scale / side.fitScale * 100);

    syncControls();
  }

  function removeUserImage(side) {
    side = side || current();
    if (!side.imageObj) return;
    side.canvas.remove(side.imageObj);
    side.imageObj = null;
    side.scalePct = 100;
    setZoneAlert(side, false);
    side.canvas.discardActiveObject();
    side.canvas.renderAll();
    syncControls();
  }

  function centerImage() {
    const side = current();
    if (!side.imageObj) return;
    side.imageObj.set({
      left: PRINT_ZONE.x + PRINT_ZONE.w / 2,
      top:  PRINT_ZONE.y + PRINT_ZONE.h / 2,
    });
    side.imageObj.setCoords();
    side.canvas.renderAll();
  }

  function applyScale(pct) {
    const side = current();
    if (!side.imageObj) return;
    pct = Math.min(MAX_SCALE_PCT, Math.max(MIN_SCALE_PCT, pct));
    side.scalePct = pct;
    const factor = side.fitScale * pct / 100;
    side.imageObj.set({ scaleX: factor, scaleY: factor });
    side.imageObj.setCoords();
    side.canvas.renderAll();
    syncControls();
  }

  function sideHasImages(s) {
    return s.canvas.getObjects().some(function (o) { return o._isUserImage; });
  }

  function syncControls() {
    const side     = current();
    const hasImage = !!side.imageObj;
    const hasAny   = sideHasImages(side);

    imageControls.style.display = hasImage ? 'block' : 'none';
    scaleSlider.value = side.scalePct;
    scaleValue.textContent = side.scalePct + '%';
    uploadSideEl.textContent = SIDE_LABELS[side.key];

    canvasHint.textContent = hasImage
      ? 'Перетаскивайте и меняйте размер в пределах пунктирной зоны печати A3'
      : hasAny
      ? 'Нажмите на картинку, чтобы выбрать её, или загрузите ещё одну'
      : `Загрузите изображение для стороны «${SIDE_LABELS[side.key]}»`;

    sideButtons.forEach(function (btn) {
      btn.classList.toggle('has-design', sideHasImages(sides[btn.dataset.side]));
    });
  }

  function switchSide(key) {
    if (!sides[key] || key === state.activeSide) return;

    current().canvas.discardActiveObject().renderAll();

    state.activeSide = key;

    Object.values(sides).forEach(function (side) {
      side.container.hidden = side.key !== key;
    });

    sideButtons.forEach(function (btn) {
      const isActive = btn.dataset.side === key;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    hideUploadError();
    syncControls();
    current().canvas.calcOffset();
  }

  function exportSide(side) {
    const fc = side.canvas;
    const zone = fc.getObjects().filter(o => o._isPrintZone);

    fc.discardActiveObject();
    zone.forEach(o => o.set('visible', false));
    fc.renderAll();

    const dataUrl = fc.toDataURL({
      format:     'jpeg',
      quality:    0.9,
      multiplier: EXPORT_SCALE / fc.getZoom(),
    });

    zone.forEach(o => o.set('visible', true));
    fc.renderAll();

    return dataUrl;
  }

  function compressOriginalImage(imageObj) {
    if (!imageObj) return null;
    var imgEl = imageObj.getElement();
    var w = imgEl.naturalWidth  || imgEl.width;
    var h = imgEl.naturalHeight || imgEl.height;
    if (!w || !h) return null;

    var MAX_DIM = 3000;
    if (w > MAX_DIM || h > MAX_DIM) {
      var ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }

    var tmp = document.createElement('canvas');
    tmp.width  = w;
    tmp.height = h;
    tmp.getContext('2d').drawImage(imgEl, 0, 0, w, h);
    return tmp.toDataURL('image/jpeg', 0.90);
  }

  // ── Все оригиналы одной стороны (массив dataURL) ────────────────────────
  function collectOriginalImages(side) {
    return side.canvas.getObjects()
      .filter(function (o) { return o._isUserImage; })
      .map(compressOriginalImage)
      .filter(function (url) { return !!url; });
  }

  // ── Сохранение дизайна обеих сторон в localStorage ──────────────────────
  function saveDesignToStorage() {
    var origFront = collectOriginalImages(sides.front);
    var origBack  = collectOriginalImages(sides.back);

    const design = {
      color:     state.color,
      colorName: state.colorName,
      size:      state.size,
      sides: {
        front: { hasImage: sideHasImages(sides.front), dataUrl: exportSide(sides.front), originalDataUrls: origFront },
        back:  { hasImage: sideHasImages(sides.back),  dataUrl: exportSide(sides.back),  originalDataUrls: origBack },
      },
    };

    try {
      localStorage.setItem('tshirtDesign', JSON.stringify(design));
      return true;
    } catch (err) {
      try {
        design.sides.front.originalDataUrls = [];
        design.sides.back.originalDataUrls  = [];
        localStorage.setItem('tshirtDesign', JSON.stringify(design));
        return true;
      } catch (err2) {
        console.error('Не удалось сохранить дизайн:', err2);
        return false;
      }
    }
  }

  // ── Привязка событий ─────────────────────────────────────────────────────

  sideButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchSide(btn.dataset.side);
    });
  });

  uploadZone.addEventListener('click', function () {
    imageInput.click();
  });

  imageInput.addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) {
      loadImage(e.target.files[0]);
    }
    e.target.value = '';
  });

  uploadZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', function () {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', function (e) {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) loadImage(file);
  });

  canvasWrapper.addEventListener('dragover', function (e) { e.preventDefault(); });
  canvasWrapper.addEventListener('drop', function (e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadImage(file);
  });

  scaleSlider.addEventListener('input', function () {
    applyScale(parseInt(scaleSlider.value, 10));
  });

  canvasWrapper.addEventListener('wheel', function (e) {
    if (!current().imageObj) return;
    e.preventDefault();

    const delta = e.deltaY < 0 ? 5 : -5;
    applyScale(current().scalePct + delta);
  }, { passive: false });

  centerBtn.addEventListener('click', centerImage);

  removeBtn.addEventListener('click', function () {
    removeUserImage();
  });

  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && current().imageObj) {
      const activeObj = current().canvas.getActiveObject();
      if (activeObj && activeObj._isUserImage) {
        removeUserImage();
      }
    }
  });

  document.querySelectorAll('.color-option').forEach(function (opt) {
    opt.addEventListener('click', function () {
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');

      state.color     = opt.dataset.color;
      state.colorName = opt.dataset.name;

      if (colorNameEl) colorNameEl.textContent = state.colorName;

      Object.values(sides).forEach(side => drawTshirt(side, state.color));
    });
  });

  document.querySelectorAll('.size-option').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.size-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.size = btn.dataset.size;
    });
  });

  orderBtn.addEventListener('click', function () {
    if (!sideHasImages(sides.front) && !sideHasImages(sides.back)) {
      showUploadError('Загрузите изображение хотя бы на одну сторону футболки.');
      return;
    }

    const outside = Object.values(sides).find(side => !isInsidePrintZone(side));
    if (outside) {
      switchSide(outside.key);
      setZoneAlert(outside, true);
      showUploadError(
        `Изображение на стороне «${SIDE_LABELS[outside.key]}» выходит за зону печати A3. ` +
        'Переместите или уменьшите его, чтобы оно поместилось в пунктирную рамку.'
      );
      return;
    }

    if (!saveDesignToStorage()) {
      showUploadError('Не удалось сохранить дизайн в браузере. Проверьте, что сайту разрешено хранить данные.');
      return;
    }

    window.location.href = 'order.html';
  });

  function resizeCanvas() {
    const canvasArea = document.querySelector('.canvas-area');
    if (!canvasArea) return;

    const header = document.querySelector('.constructor-header');
    const areaW = canvasArea.clientWidth - 80;
    const areaH = window.innerHeight - (header ? header.offsetHeight : 0) - 190;
    const maxW  = Math.max(200, Math.min(areaW, areaH * (CANVAS_W / CANVAS_H), CANVAS_W));
    const scale = maxW / CANVAS_W;

    Object.values(sides).forEach(function (side) {
      side.canvas.setZoom(scale);
      side.canvas.setWidth(CANVAS_W  * scale);
      side.canvas.setHeight(CANVAS_H * scale);
      side.canvas.renderAll();
    });
  }

  window.addEventListener('resize', resizeCanvas);

  Object.values(sides).forEach(side => drawTshirt(side, state.color));
  resizeCanvas();
  syncControls();

})();