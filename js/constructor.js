/* ============================================================
   constructor.js — логика конструктора футболок
   Использует Fabric.js для работы с Canvas
   ============================================================ */

(function () {
  'use strict';

  // ── Константы размеров канваса ───────────────────────────────────────────
  const CANVAS_W = 500;
  const CANVAS_H = 560;

  // Область печати на футболке (куда можно класть изображение)
  const PRINT_ZONE = {
    x: CANVAS_W * 0.28,
    y: CANVAS_H * 0.30,
    w: CANVAS_W * 0.44,
    h: CANVAS_H * 0.42,
  };

  // ── Состояние приложения ──────────────────────────────────────────────────
  const state = {
    color:     '#f8fafc',   // текущий цвет футболки
    colorName: 'Белый',     // название цвета
    size:      'M',         // выбранный размер
    imageObj:  null,        // объект Fabric.Image
  };

  // ── Ссылки на DOM-элементы ────────────────────────────────────────────────
  const canvasEl       = document.getElementById('tshirt-canvas');
  const uploadZone     = document.getElementById('upload-zone');
  const imageInput     = document.getElementById('image-input');
  const imageControls  = document.getElementById('image-controls');
  const scaleSlider    = document.getElementById('scale-slider');
  const scaleValue     = document.getElementById('scale-value');
  const centerBtn      = document.getElementById('center-btn');
  const removeBtn      = document.getElementById('remove-image-btn');
  const orderBtn       = document.getElementById('order-btn');
  const canvasHint     = document.getElementById('canvas-hint');
  const colorNameEl    = document.getElementById('selected-color-name');

  // ── Инициализация Fabric.js ──────────────────────────────────────────────
  const fabricCanvas = new fabric.Canvas('tshirt-canvas', {
    width:               CANVAS_W,
    height:              CANVAS_H,
    selection:           false,   // отключаем групповое выделение
    preserveObjectStacking: true,
  });

  // ── Рисуем футболку на нижнем слое ──────────────────────────────────────
  function drawTshirt(color) {
    // Удаляем старые объекты футболки (не пользовательские изображения)
    const oldShapes = fabricCanvas.getObjects().filter(o => o._isTshirt);
    oldShapes.forEach(o => fabricCanvas.remove(o));

    // Цвет обводки — немного темнее основного цвета
    const strokeColor = darkenHex(color, 25);

    // Тень под футболкой
    fabricCanvas.setBackgroundColor('#e8edf3', fabricCanvas.renderAll.bind(fabricCanvas));

    // Строим путь силуэта футболки через Fabric Path
    const W = CANVAS_W;
    const H = CANVAS_H;

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
       Q ${W*0.58} ${H*0.19} ${W*0.50} ${H*0.19}
       Q ${W*0.42} ${H*0.19} ${W*0.30} ${H*0.10}
       Z`,
      {
        fill:            color,
        stroke:          strokeColor,
        strokeWidth:     2,
        selectable:      false,
        evented:         false,
        _isTshirt:       true,   // маркер, чтобы отличать от пользовательских объектов
        shadow:          new fabric.Shadow({
          color:   'rgba(0,0,0,0.18)',
          blur:    20,
          offsetX: 0,
          offsetY: 8,
        }),
      }
    );

    // Добавляем в начало стека (под изображение)
    fabricCanvas.insertAt(tshirtPath, 0);

    // Рисуем обозначение зоны печати (пунктирный прямоугольник)
    const printZoneRect = new fabric.Rect({
      left:          PRINT_ZONE.x,
      top:           PRINT_ZONE.y,
      width:         PRINT_ZONE.w,
      height:        PRINT_ZONE.h,
      fill:          'transparent',
      stroke:        'rgba(37,99,235,0.25)',
      strokeWidth:   1.5,
      strokeDashArray: [6, 4],
      selectable:    false,
      evented:       false,
      _isTshirt:     true,
    });

    fabricCanvas.insertAt(printZoneRect, 1);
    fabricCanvas.renderAll();
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

  // ── Ограничиваем перемещение изображения пределами зоны печати ──────────
  function constrainImage(img) {
    // Объект Fabric умеет задавать clipPath, но проще ограничить через события
    img.on('moving', function () {
      const half = { w: (img.getScaledWidth()  / 2), h: (img.getScaledHeight() / 2) };

      const minX = PRINT_ZONE.x + half.w;
      const maxX = PRINT_ZONE.x + PRINT_ZONE.w - half.w;
      const minY = PRINT_ZONE.y + half.h;
      const maxY = PRINT_ZONE.y + PRINT_ZONE.h - half.h;

      img.left = Math.min(Math.max(img.left, minX), maxX);
      img.top  = Math.min(Math.max(img.top,  minY), maxY);
    });
  }

  // ── Загрузка изображения ─────────────────────────────────────────────────
  function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) {
      alert('Пожалуйста, выберите файл изображения (PNG, JPG, GIF).');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('Файл слишком большой. Максимальный размер — 10 МБ.');
      return;
    }

    const reader = new FileReader();

    reader.onload = function (e) {
      const dataUrl = e.target.result;

      // Удаляем предыдущее пользовательское изображение, если есть
      removeUserImage();

      fabric.Image.fromURL(dataUrl, function (img) {
        // Масштабируем изображение так, чтобы оно вписалось в зону печати
        const maxW = PRINT_ZONE.w * 0.85;
        const maxH = PRINT_ZONE.h * 0.85;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);

        img.set({
          left:       PRINT_ZONE.x + PRINT_ZONE.w / 2,
          top:        PRINT_ZONE.y + PRINT_ZONE.h / 2,
          originX:    'center',
          originY:    'center',
          scaleX:     scale,
          scaleY:     scale,
          hasControls: true,       // рамка с ручками управления
          hasBorders:  true,
          cornerStyle: 'circle',
          cornerColor: '#2563eb',
          cornerStrokeColor: '#fff',
          transparentCorners: false,
          cornerSize: 10,
          _isUserImage: true,      // маркер пользовательского изображения
        });

        // Ограничиваем перемещение зоной печати
        constrainImage(img);

        // Синхронизируем ползунок масштаба с текущим масштабом объекта
        img.on('scaling', function () {
          const avgScale = (img.scaleX + img.scaleY) / 2;
          const pct = Math.round(avgScale / scale * 100);
          scaleSlider.value = Math.min(200, Math.max(10, pct));
          scaleValue.textContent = scaleSlider.value + '%';
        });

        fabricCanvas.add(img);
        fabricCanvas.setActiveObject(img);
        fabricCanvas.renderAll();

        state.imageObj = img;

        // Показываем элементы управления
        imageControls.style.display = 'block';
        canvasHint.textContent = 'Перетащите изображение или используйте ручки для изменения размера';

        // Сбрасываем ползунок к 100%
        scaleSlider.value = 100;
        scaleValue.textContent = '100%';

      }, { crossOrigin: 'anonymous' });
    };

    reader.readAsDataURL(file);
  }

  // ── Удаление пользовательского изображения ───────────────────────────────
  function removeUserImage() {
    const userImages = fabricCanvas.getObjects().filter(o => o._isUserImage);
    userImages.forEach(o => fabricCanvas.remove(o));
    state.imageObj = null;
    imageControls.style.display = 'none';
    canvasHint.textContent = 'Загрузите изображение, чтобы начать';
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();
  }

  // ── Центрирование изображения в зоне печати ──────────────────────────────
  function centerImage() {
    if (!state.imageObj) return;
    state.imageObj.set({
      left: PRINT_ZONE.x + PRINT_ZONE.w / 2,
      top:  PRINT_ZONE.y + PRINT_ZONE.h / 2,
    });
    state.imageObj.setCoords();
    fabricCanvas.renderAll();
  }

  // ── Сохранение дизайна в localStorage перед переходом на страницу заказа ─
  function saveDesignToStorage() {
    const design = {
      color:        state.color,
      colorName:    state.colorName,
      size:         state.size,
      imageDataUrl: null,
    };

    // Сохраняем изображение как dataURL, если оно есть
    if (state.imageObj) {
      // Временно снимаем выделение, чтобы не сохранять рамку
      fabricCanvas.discardActiveObject();
      fabricCanvas.renderAll();
      design.imageDataUrl = fabricCanvas.toDataURL({ format: 'png', quality: 0.7 });
    }

    localStorage.setItem('tshirtDesign', JSON.stringify(design));
  }

  // ── Привязка событий ─────────────────────────────────────────────────────

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

  // Также поддерживаем drag & drop на канвас напрямую
  canvasEl.addEventListener('dragover', function (e) { e.preventDefault(); });
  canvasEl.addEventListener('drop', function (e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadImage(file);
  });

  // Масштабирование через ползунок
  scaleSlider.addEventListener('input', function () {
    if (!state.imageObj) return;
    const pct    = parseInt(scaleSlider.value);
    scaleValue.textContent = pct + '%';
    const factor = pct / 100;
    state.imageObj.set({ scaleX: factor, scaleY: factor });
    state.imageObj.setCoords();
    fabricCanvas.renderAll();
  });

  // Масштабирование колёсиком мыши на канвасе
  canvasEl.addEventListener('wheel', function (e) {
    if (!state.imageObj) return;
    e.preventDefault();

    const delta  = e.deltaY < 0 ? 5 : -5;
    const newVal = Math.min(200, Math.max(10, parseInt(scaleSlider.value) + delta));
    scaleSlider.value = newVal;
    scaleValue.textContent = newVal + '%';

    const factor = newVal / 100;
    state.imageObj.set({ scaleX: factor, scaleY: factor });
    state.imageObj.setCoords();
    fabricCanvas.renderAll();
  }, { passive: false });

  // Кнопка «По центру»
  centerBtn.addEventListener('click', centerImage);

  // Кнопка «Удалить»
  removeBtn.addEventListener('click', removeUserImage);

  // Клавиша Delete — удалить активный объект
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.imageObj) {
      const activeObj = fabricCanvas.getActiveObject();
      if (activeObj && activeObj._isUserImage) {
        removeUserImage();
      }
    }
  });

  // Выбор цвета футболки
  document.querySelectorAll('.color-option').forEach(function (opt) {
    opt.addEventListener('click', function () {
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');

      state.color     = opt.dataset.color;
      state.colorName = opt.dataset.name;

      if (colorNameEl) colorNameEl.textContent = state.colorName;

      drawTshirt(state.color);
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
    saveDesignToStorage();
    window.location.href = 'order.html';
  });

  // ── Адаптивный размер канваса ────────────────────────────────────────────
  function resizeCanvas() {
    const canvasArea = document.querySelector('.canvas-area');
    if (!canvasArea) return;

    const areaW = canvasArea.clientWidth  - 80;
    const areaH = canvasArea.clientHeight - 80;
    const maxW  = Math.min(areaW, areaH * (CANVAS_W / CANVAS_H), CANVAS_W);
    const scale = maxW / CANVAS_W;

    fabricCanvas.setZoom(scale);
    fabricCanvas.setWidth(CANVAS_W  * scale);
    fabricCanvas.setHeight(CANVAS_H * scale);
    fabricCanvas.renderAll();
  }

  window.addEventListener('resize', resizeCanvas);

  // ── Инициализация при загрузке страницы ──────────────────────────────────
  drawTshirt(state.color);
  resizeCanvas();

})();
