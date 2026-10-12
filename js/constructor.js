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
  // Оборудование печатает только этот формат, поэтому изображение
  // нельзя ни вынести за рамку, ни растянуть больше неё.
  const ZONE_H = CANVAS_H * 0.48;
  const ZONE_W = ZONE_H * (MAX_IMG_W / MAX_IMG_H);
  const PRINT_ZONE = {
    x: (CANVAS_W - ZONE_W) / 2,
    y: CANVAS_H * 0.27,
    w: ZONE_W,
    h: ZONE_H,
  };

  // Допуск на погрешность вычислений с плавающей точкой (в пикселях канваса)
  const ZONE_EPS = 0.5;

  // Цвета рамки зоны печати: обычный и «упёрлись в границу»
  const ZONE_COLOR       = 'rgba(204,255,0,0.9)';
  const ZONE_ALERT_COLOR = '#ff4d4f';

  // Минимальный масштаб — в процентах от максимального (вся зона A3)
  const MIN_SCALE_PCT = 10;
  const MAX_SCALE_PCT = 100;

  // Во сколько раз экспорт крупнее «логического» размера канваса (500×560)
  const EXPORT_SCALE = 2;

  // Подписи сторон для интерфейса
  const SIDE_LABELS = { front: 'перед', back: 'спина' };

  // ── Состояние приложения ──────────────────────────────────────────────────
  const state = {
    color:      '#f8fafc',   // текущий цвет футболки (общий для обеих сторон)
    colorName:  'Белый',     // название цвета
    size:       'M',         // выбранный размер
    activeSide: 'front',     // какая сторона сейчас на экране
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
      selection:              false,   // отключаем групповое выделение
      preserveObjectStacking: true,
      uniScaleKey:            null,    // Shift не включает растягивание без сохранения пропорций
    });

    return {
      key:       key,
      canvas:    canvas,
      container: document.getElementById(containerId),
      imageObj:  null,   // объект Fabric.Image с дизайном этой стороны
      fitScale:  1,      // масштаб, при котором картинка занимает всю зону A3 (= 100%, максимум)
      scalePct:  100,    // текущее значение ползунка для этой стороны
      zoneRect:  null,   // пунктирная рамка зоны печати (для подсветки при упоре)
    };
  }

  const sides = {
    front: createSide('front', 'canvas-front', 'side-front'),
    back:  createSide('back',  'canvas-back',  'side-back'),
  };

  // Текущая активная сторона
  function current() {
    return sides[state.activeSide];
  }

  // ── Рисуем футболку на нижнем слое ──────────────────────────────────────
  function drawTshirt(side, color) {
    const fc = side.canvas;

    // Удаляем старые объекты футболки (не пользовательские изображения)
    fc.getObjects().filter(o => o._isTshirt).forEach(o => fc.remove(o));

    // Цвет обводки — немного темнее основного цвета
    const strokeColor = darkenHex(color, 25);

    fc.setBackgroundColor('#161616', fc.renderAll.bind(fc));

    const W = CANVAS_W;
    const H = CANVAS_H;

    // Спереди горловина глубокая, сзади — почти прямая
    const neckY = side.key === 'front' ? 0.19 : 0.13;

    const tshirtPath = new fabric.Path(
      // M = начало, L = линия, Q = квадратичная кривая, Z = закрыть
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
        _isTshirt:   true,   // маркер, чтобы отличать от пользовательских объектов
        shadow:      new fabric.Shadow({
          color:   'rgba(0,0,0,0.55)',
          blur:    20,
          offsetX: 0,
          offsetY: 8,
        }),
      }
    );

    // Добавляем в начало стека (под изображение)
    fc.insertAt(tshirtPath, 0);

    // Подпись стороны над подолом, чтобы на макете было видно, где перед, а где спина
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

    // Обозначение зоны печати A3 — только подсказка, в заказ не попадает.
    // Под пунктиром тёмная линия, чтобы рамку было видно на футболке любого цвета.
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

    // Подпись под рамкой: изображение туда попасть не может, значит не перекроет её
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

  // ── Подсветка рамки зоны печати, когда изображение упёрлось в границу ────
  function setZoneAlert(side, isAlert) {
    if (!side.zoneRect) return;
    const color = isAlert ? ZONE_ALERT_COLOR : ZONE_COLOR;
    if (side.zoneRect.stroke === color) return;
    side.zoneRect.set('stroke', color);
    side.canvas.requestRenderAll();
  }

  // ── Вспомогательная: затемнить hex-цвет ─────────────────────────────────
  function darkenHex(hex, amount) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = Math.max(0, parseInt(hex.slice(0, 2), 16) - amount);
    const g = Math.max(0, parseInt(hex.slice(2, 4), 16) - amount);
    const b = Math.max(0, parseInt(hex.slice(4, 6), 16) - amount);
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  // ── Границы масштаба стороны (абсолютные значения scaleX/scaleY) ─────────
  function minScale(side) { return side.fitScale * MIN_SCALE_PCT / 100; }
  function maxScale(side) { return side.fitScale * MAX_SCALE_PCT / 100; }

  // ── Сдвинуть изображение внутрь зоны печати. Возвращает true, если пришлось ─
  // (изображение с originX/Y = 'center' и без поворота)
  function clampPosition(img) {
    const halfW = img.getScaledWidth()  / 2;
    const halfH = img.getScaledHeight() / 2;

    const left = Math.min(Math.max(img.left, PRINT_ZONE.x + halfW), PRINT_ZONE.x + PRINT_ZONE.w - halfW);
    const top  = Math.min(Math.max(img.top,  PRINT_ZONE.y + halfH), PRINT_ZONE.y + PRINT_ZONE.h - halfH);

    const moved = Math.abs(left - img.left) > ZONE_EPS || Math.abs(top - img.top) > ZONE_EPS;
    img.set({ left: left, top: top });
    return moved;
  }

  // ── Ограничение масштабирования ручками: изображение «упирается» в рамку ──
  // Fabric держит неподвижной точку-якорь (противоположный угол, при Alt — центр).
  // Считаем, сколько места есть от якоря до границ зоны, и не даём вырасти больше.
  function clampScaling(side, img, transform) {
    const w  = img.width;
    const h  = img.height;
    const ox = transform.originX;   // 'left' | 'right' | 'center'
    const oy = transform.originY;   // 'top'  | 'bottom' | 'center'

    const halfW = img.getScaledWidth()  / 2;
    const halfH = img.getScaledHeight() / 2;
    const anchorX = ox === 'left' ? img.left - halfW : ox === 'right' ? img.left + halfW : img.left;
    const anchorY = oy === 'top'  ? img.top  - halfH : oy === 'bottom' ? img.top + halfH : img.top;

    const zoneR = PRINT_ZONE.x + PRINT_ZONE.w;
    const zoneB = PRINT_ZONE.y + PRINT_ZONE.h;
    const availW = ox === 'left'  ? zoneR - anchorX
                 : ox === 'right' ? anchorX - PRINT_ZONE.x
                 : 2 * Math.min(anchorX - PRINT_ZONE.x, zoneR - anchorX);
    const availH = oy === 'top'    ? zoneB - anchorY
                 : oy === 'bottom' ? anchorY - PRINT_ZONE.y
                 : 2 * Math.min(anchorY - PRINT_ZONE.y, zoneB - anchorY);

    const upper = Math.min(maxScale(side), availW / w, availH / h);
    const s = Math.min(Math.max(img.scaleX, minScale(side)), Math.max(upper, minScale(side)));
    const hitLimit = img.scaleX > upper + 1e-6;

    // Пересчитываем центр так, чтобы якорь остался на месте
    const sw = w * s / 2;
    const sh = h * s / 2;
    img.set({
      scaleX: s,
      scaleY: s,
      left: ox === 'left' ? anchorX + sw : ox === 'right' ? anchorX - sw : anchorX,
      top:  oy === 'top'  ? anchorY + sh : oy === 'bottom' ? anchorY - sh : anchorY,
    });

    // Подстраховка: если якорь сам оказался у края, просто сдвигаем внутрь
    return clampPosition(img) || hitLimit;
  }

  // ── Привязка ограничений зоны печати к изображению ───────────────────────
  function constrainImage(side, img) {
    img.on('moving', function () {
      setZoneAlert(side, clampPosition(img));
    });

    img.on('scaling', function (opt) {
      setZoneAlert(side, clampScaling(side, img, opt.transform));
      side.scalePct = Math.round(img.scaleX / side.fitScale * 100);
      if (side === current()) syncControls();
    });

    // Отпустили мышь — рамка снова обычного цвета
    img.on('modified', function () {
      img.setCoords();
      setZoneAlert(side, false);
    });
  }

  // ── Проверка: изображение стороны целиком внутри зоны A3 ─────────────────
  function isInsidePrintZone(side) {
    const img = side.imageObj;
    if (!img) return true;

    const r = img.getBoundingRect(true, true);   // в координатах сцены, без учёта zoom
    return r.left >= PRINT_ZONE.x - ZONE_EPS &&
           r.top  >= PRINT_ZONE.y - ZONE_EPS &&
           r.left + r.width  <= PRINT_ZONE.x + PRINT_ZONE.w + ZONE_EPS &&
           r.top  + r.height <= PRINT_ZONE.y + PRINT_ZONE.h + ZONE_EPS;
  }

  // ── Сообщения об ошибке загрузки ─────────────────────────────────────────
  function showUploadError(text) {
    uploadError.textContent = text;
    uploadError.hidden = false;
  }

  function hideUploadError() {
    uploadError.hidden = true;
    uploadError.textContent = '';
  }

  // ── Загрузка изображения на активную сторону ─────────────────────────────
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

    // Запоминаем сторону: пока файл читается, пользователь может переключиться
    const side = current();
    const reader = new FileReader();

    reader.onload = function (e) {
      const imgEl = new Image();

      imgEl.onload = function () {
        const w = imgEl.naturalWidth;
        const h = imgEl.naturalHeight;

        // Проверка размеров: не больше листа A3 при 300 DPI
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

  // ── Размещение проверенного изображения на канвасе стороны ───────────────
  function placeImage(side, imgEl) {
    // Удаляем предыдущее изображение этой стороны, если есть
    removeUserImage(side);

    const img = new fabric.Image(imgEl);

    // 100% — изображение занимает всю зону A3 по ширине или высоте; больше нельзя.
    // Стартовый размер — 85% зоны, а маленькие картинки не растягиваем.
    side.fitScale = Math.min(PRINT_ZONE.w / img.width, PRINT_ZONE.h / img.height);
    const scale = Math.min(Math.max(Math.min(side.fitScale * 0.85, 1), minScale(side)), maxScale(side));

    img.set({
      left:               PRINT_ZONE.x + PRINT_ZONE.w / 2,
      top:                PRINT_ZONE.y + PRINT_ZONE.h / 2,
      originX:            'center',
      originY:            'center',
      scaleX:             scale,
      scaleY:             scale,
      hasControls:        true,       // рамка с ручками управления
      hasBorders:         true,
      cornerStyle:        'circle',
      cornerColor:        '#ccff00',
      cornerStrokeColor:  '#0a0a0a',
      transparentCorners: false,
      cornerSize:         10,
      // Только пропорциональное масштабирование за углы и без поворота:
      // так габариты изображения всегда совпадают с проверяемой рамкой
      lockRotation:       true,
      lockScalingFlip:    true,
      lockSkewingX:       true,
      lockSkewingY:       true,
      _isUserImage:       true,       // маркер пользовательского изображения
    });
    img.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false, mtr: false });

    // Перемещение и масштаб ограничены зоной печати A3
    constrainImage(side, img);

    side.canvas.add(img);
    side.canvas.setActiveObject(img);
    side.canvas.renderAll();

    side.imageObj  = img;
    side.scalePct  = Math.round(scale / side.fitScale * 100);

    syncControls();
  }

  // ── Удаление пользовательского изображения со стороны ────────────────────
  function removeUserImage(side) {
    side = side || current();
    side.canvas.getObjects().filter(o => o._isUserImage).forEach(o => side.canvas.remove(o));
    side.imageObj  = null;
    side.scalePct  = 100;
    setZoneAlert(side, false);
    side.canvas.discardActiveObject();
    side.canvas.renderAll();
    syncControls();
  }

  // ── Центрирование изображения в зоне печати ──────────────────────────────
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

  // ── Применить масштаб (в процентах от максимального, 100% = вся зона A3) ──
  // Масштаб идёт от центра; если изображение задевает рамку — сдвигаем внутрь.
  function applyScale(pct) {
    const side = current();
    if (!side.imageObj) return;
    pct = Math.min(MAX_SCALE_PCT, Math.max(MIN_SCALE_PCT, pct));
    side.scalePct = pct;
    const factor = side.fitScale * pct / 100;
    side.imageObj.set({ scaleX: factor, scaleY: factor });
    clampPosition(side.imageObj);
    side.imageObj.setCoords();
    side.canvas.renderAll();
    syncControls();
  }

  // ── Обновить панель управления под активную сторону ──────────────────────
  function syncControls() {
    const side = current();
    const hasImage = !!side.imageObj;

    imageControls.style.display = hasImage ? 'block' : 'none';
    scaleSlider.value = side.scalePct;
    scaleValue.textContent = side.scalePct + '%';
    uploadSideEl.textContent = SIDE_LABELS[side.key];

    canvasHint.textContent = hasImage
      ? 'Перетаскивайте и меняйте размер в пределах пунктирной зоны печати A3'
      : `Загрузите изображение для стороны «${SIDE_LABELS[side.key]}»`;

    // Отмечаем на переключателе стороны, где уже есть дизайн
    sideButtons.forEach(function (btn) {
      btn.classList.toggle('has-design', !!sides[btn.dataset.side].imageObj);
    });
  }

  // ── Переключение стороны «Перед / Спина» ─────────────────────────────────
  function switchSide(key) {
    if (!sides[key] || key === state.activeSide) return;

    // Снимаем выделение со старой стороны, чтобы рамка не «зависла»
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
    current().canvas.calcOffset();   // Fabric пересчитывает позицию после показа
  }

  // ── Экспорт стороны в картинку (без рамки выделения и пунктира зоны печати) ─
  function exportSide(side) {
    const fc = side.canvas;
    const zone = fc.getObjects().filter(o => o._isPrintZone);

    fc.discardActiveObject();
    zone.forEach(o => o.set('visible', false));
    fc.renderAll();

    // Канвас может быть уменьшен под экран — компенсируем zoom, чтобы размер был постоянным
    const dataUrl = fc.toDataURL({
      format:     'jpeg',
      quality:    0.9,
      multiplier: EXPORT_SCALE / fc.getZoom(),
    });

    zone.forEach(o => o.set('visible', true));
    fc.renderAll();

    return dataUrl;
  }

  // ── Сохранение дизайна обеих сторон в localStorage перед переходом к заказу ─
  function saveDesignToStorage() {
    const design = {
      color:     state.color,
      colorName: state.colorName,
      size:      state.size,
      sides: {
        front: { hasImage: !!sides.front.imageObj, dataUrl: exportSide(sides.front) },
        back:  { hasImage: !!sides.back.imageObj,  dataUrl: exportSide(sides.back) },
      },
    };

    try {
      localStorage.setItem('tshirtDesign', JSON.stringify(design));
      return true;
    } catch (err) {
      // Например, переполнено хранилище или оно отключено в приватном режиме
      console.error('Не удалось сохранить дизайн:', err);
      return false;
    }
  }

  // ── Привязка событий ─────────────────────────────────────────────────────

  // Переключатель сторон
  sideButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchSide(btn.dataset.side);
    });
  });

  // Клик по зоне загрузки → открываем диалог выбора файла
  uploadZone.addEventListener('click', function () {
    imageInput.click();
  });

  // Выбор файла через <input>
  imageInput.addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) {
      loadImage(e.target.files[0]);
    }
    // Сбрасываем input, чтобы можно было загрузить тот же файл повторно
    e.target.value = '';
  });

  // Перетаскивание файла (drag & drop)
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

  // Drag & drop прямо на канвас (слушаем обёртку: события ловит верхний слой Fabric)
  canvasWrapper.addEventListener('dragover', function (e) { e.preventDefault(); });
  canvasWrapper.addEventListener('drop', function (e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadImage(file);
  });

  // Масштабирование через ползунок
  scaleSlider.addEventListener('input', function () {
    applyScale(parseInt(scaleSlider.value, 10));
  });

  // Масштабирование колёсиком мыши на канвасе
  canvasWrapper.addEventListener('wheel', function (e) {
    if (!current().imageObj) return;
    e.preventDefault();

    const delta = e.deltaY < 0 ? 5 : -5;
    applyScale(current().scalePct + delta);
  }, { passive: false });

  // Кнопка «По центру»
  centerBtn.addEventListener('click', centerImage);

  // Кнопка «Удалить»
  removeBtn.addEventListener('click', function () {
    removeUserImage();
  });

  // Клавиша Delete — удалить активный объект
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && current().imageObj) {
      const activeObj = current().canvas.getActiveObject();
      if (activeObj && activeObj._isUserImage) {
        removeUserImage();
      }
    }
  });

  // Выбор цвета футболки — меняется у обеих сторон сразу
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

  // Выбор размера
  document.querySelectorAll('.size-option').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.size-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.size = btn.dataset.size;
    });
  });

  // Кнопка «Оформить заказ»
  orderBtn.addEventListener('click', function () {
    if (!sides.front.imageObj && !sides.back.imageObj) {
      showUploadError('Загрузите изображение хотя бы на одну сторону футболки.');
      return;
    }

    // Печать возможна только в пределах листа A3 — проверяем обе стороны
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

  // ── Адаптивный размер канваса ────────────────────────────────────────────
  function resizeCanvas() {
    const canvasArea = document.querySelector('.canvas-area');
    if (!canvasArea) return;

    // Высоту берём от окна (область растягивается вместе с панелью справа),
    // за вычетом шапки, переключателя сторон и подсказки
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

  // ── Инициализация при загрузке страницы ──────────────────────────────────
  Object.values(sides).forEach(side => drawTshirt(side, state.color));
  resizeCanvas();
  syncControls();

})();
