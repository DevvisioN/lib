(function ($, namespace, pluginsCatalog, util, translations) {
  var imagerInstances = [];

  var PLATFORM = {
    ios: 'ios',
    android: 'android',
    windowsMobile: 'windowsMobile',
    genericMobile: 'genericMobile'
  };

  /**
   *
   * @param $imageElement <img> Element to attach to
   *
   * @param options {Object} Options
   * @param options.editModeCss {Object} Css object for image edit box.
   * <br>
   * For example, to make background transparent like in photoshop, try this:
   * <br>
   * <code><pre>
   *   {
   *    "background": "url(assets/transparent.png)"
   *   }
   * </pre></code>
   * <br>
   *
   * Edit box border also could be set here like this:
   * <br>
   * <code><pre>
   *   {
   *    "border": "1px dashed green"
   *   }
   * </pre></code>
   *
   * @param {Function} options.detectTouch
   * A custom function that will be used by ImagerJs to determine whether it is
   * running on touch device or not.
   * <br><br>
   *
   * This function must return <code>true</code> or <code>false</code>.
   * <br><br>
   *
   * <code>true</code> means that touch device is detected and ImagerJs should
   * adjust its toolbar size, add touch events etc.
   * <br><br>
   *
   * Note that if this function is not specified, ImagerJs will use its own
   * detection mechanism.
   * <br><br>
   *
   * To disable any detection simply set this parameter to such function:
   * <code><pre>function() { return false; }</pre></code>
   *
   * @param {String} options.waitingCursor
   * Cursor that will be used for long-running operations.
   * <br><br>
   *
   * Example:
   * <code><pre>url(path/to/cursor.cur), default</pre></code>
   *
   * Note the word 'default' at the end: that is the name of cursor that will
   * be used when url is unavailable.
   *
   * More information about css cursor property could be found here:
   * {@link https://developer.mozilla.org/en-US/docs/Web/CSS/cursor}
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/CSS/cursor}
   *
   * @param {Number} options.imageSizeForPerformanceWarning Size in bytes.
   *
   * If image is bigger that provided number, an alert will be shown
   * saying that such big images could cause serious performance issues.
   *
   * @param {Number} options.maxImageWidth Maximum image width in pixels.
   *
   * If image is width is larger than this value it will be scaled down with .
   * This option allows avoiding bad performance with large images.
   *
   * @param {Number} options.maxImageHeight Maximum image height in pixels.
   *
   * If image is width is larger than this value it will be scaled down with .
   * This option allows avoiding bad performance with large images.
   *
   * @param {Number} options.canvasSizeLimit : Maximum canvas size, in pixels.
   * Canvas is scaled down, if it gets more then this value.
   * Default is 32 megapixels for desktop, and 5 megapixels for mobile.
   * Warning: if canvasSizeLimit is set larger, then browser restrictions, big images can fail to load.
   *
   * If image is height is larger than this value it will be scaled down.
   * This option allows avoiding bad performance with large images.
   *
   * @constructor
   * @memberof ImagerJs
   */
  var Imager = function ($imageElement, options) {
    var _this = this;

    _this.$imageElement = $($imageElement);

    _this.defaultOptions = {
      saveData: undefined,
      loadData: undefined,
      quality: 1,
      targetScale: 1,
      plugins: [],
      format: undefined,
      toolbarButtonSize: 32,
      toolbarButtonSizeTouch: 50,
      editModeCss: {
        border: '1px solid white'
      },
      pluginsConfig: {},
      detectTouch: null,
      waitingCursor: 'wait',
      imageSizeForPerformanceWarning: 1000000, // 1 MB
      maxImageWidth: 2048,
      maxImageHeight: 2048
    };

    options = options ? options : {};
    _this.options = $.extend(true, _this.defaultOptions, options);

    _this.debug = false;

    /**
     * Whether to show temporary canvases that are used to render some image states
     * before final rendering to the canvas that user sees.
     *
     * Use this for debugging with breakpoints.
     *
     * @type {boolean}
     */
    _this.showTemporaryCanvas = false;

    _this.targetScale = _this.options.targetScale;
    _this.quality = _this.options.quality;

    _this._eventEmitter = $({});
    _this._isInEditMode = false;

    /**
     * Array containing operations history with images.
     * @type {Array}
     */
    _this.history = [];

    imagerInstances.push(_this);

    /**
     * Will be set only for jpeg images.
     * Stores exif info of the original image.
     * @type {null|Object}
     */
    _this.originalExif = null;

    // detect Platform
    this.detectPlatform();

    // if no canvasSizeLimit set in options, set it
    if (!this.options.canvasSizeLimit) {
      if ([PLATFORM.ios, PLATFORM.android, PLATFORM.windowsMobile].indexOf(_this.platform) !== -1) {
        // 5 MP on devices
        this.canvasSizeLimit = 5 * 1024 * 1024;
      } else {
        // 32 MP on desktop
        this.canvasSizeLimit = 32 * 1024 * 1024;
      }
    }

    _this.$originalImage = _this.$imageElement.clone();

    _this.handleImageElementSrcChanged();


    /**
     * Imager will instantiate all plugins and store them here.
     * @type {Object|null}
     */
    _this.pluginsInstances = null;
    _this.instantiatePlugins(pluginsCatalog);

    $('body').on('imagerResize', function () {
      _this.adjustEditContainer();
    });

    $(window).on('resize', function () {
      _this.adjustEditContainer();
    });
  };

  Imager.prototype.on = function (event, handler) {
    this._eventEmitter.on(event, handler);
  };

  Imager.prototype.off = function (event) {
    this._eventEmitter.off(event);
  };

  Imager.prototype.trigger = function (event, args) {
    this._eventEmitter.trigger(event, args);

    var eventMethodName = 'on' +
      event.substr(0, 1).toUpperCase() + event.substr(1);

    for (var i = 0; i < this.pluginsInstances.length; i++) {
      var p = this.pluginsInstances[i];

      if (p[eventMethodName] !== undefined) {
        p[eventMethodName](args);
      }
    }
  };

  Imager.prototype.log = function () {
    if (this.debug) {
      var args = Array.prototype.slice.call(arguments);
      console.log.apply(console, args);
    }
  };

  Imager.prototype.invokePluginsMethod = function (methodName) {
    var results = [];

    var args = Array.prototype.slice.call(arguments);

    args = args.slice(1); // remove method name

    for (var i = 0; i < this.pluginsInstances.length; i++) {
      var p = this.pluginsInstances[i];

      if (p[methodName] !== undefined) {
        var result = p[methodName].apply(p, args);

        if (result) {
          results.push({
            name: p.__name,
            instance: p,
            result: result
          });
        }
      }
    }

    return results;
  };

  /**
   * Sorts plugins based in their `weight`
   */
  Imager.prototype.pluginSort = function (p1, p2) {
    if (p1.weight === undefined || p2.weight === null) {
      p1.weight = Infinity;
    }

    if (p2.weight === undefined || p2.weight === null) {
      p2.weight = Infinity;
    }

    if (p1.weight < p2.weight) {
      return -1;
    }

    if (p1.weight > p2.weight) {
      return 1;
    }

    return 0;
  };

  /*
   * Iterates through plugins array from config and instantiates them.
   */
  Imager.prototype.instantiatePlugins = function (plugins) {
    this.pluginsInstances = [];

    for (var pluginName in plugins) {
      if (this.options.plugins.indexOf(pluginName) > -1) {
        if (plugins.hasOwnProperty(pluginName)) {
          var pluginInstance = new plugins[pluginName](
            this, this.options.pluginsConfig[pluginName]
          );

          pluginInstance.__name = pluginName;
          this.pluginsInstances.push(pluginInstance);
        }
      }
    }

    this.pluginsInstances.sort(this.pluginSort);
  };

  /**
   * Returns plugin instance by its name
   *
   * @param pluginName
   * @returns {*}
   */
  Imager.prototype.getPluginInstance = function (pluginName) {
    for (var i = 0; i < this.pluginsInstances.length; i++) {
      var p = this.pluginsInstances[i];

      if (p.__name == pluginName) {
        return p;
      }
    }

    return undefined;
  };

  /**
   * This function should be called when image's `src` attribute is changed from outside of the imager.
   * It checks `src` attribute, detects image format, prepares image (rotates it according to EXIF for example)
   * and triggers `ready` event on imager.
   */
  Imager.prototype.handleImageElementSrcChanged = function () {
    var _this = this;

    if (!_this.options.format) {
      _this.options.format = _this.getImageFormat(_this.$imageElement.attr('src'));
    }

    if (_this.$imageElement.attr('data-imager-id')) {
      // if image already has an id, then it has been edited using Imager.
      // and should contain original image data somewhere
      _this.id = _this.$imageElement.attr('data-imager-id');

      if (_this.$imageElement.attr('src').length < 1) {
        throw new Error('Imager was initialized on an empty image. Please check image\'s `src` attribute. ' +
          'It should not be empty.');
      }
    } else {
      _this.id = util.uuid();
      _this.$imageElement.attr('data-imager-id', _this.id);
    }

    //region prepare image
    // Photo needs some preparations before it could be used by imager.
    // Fix EXIF rotation data, make image smaller on slow devices etc.
    _this.fixImageSizeAndRotation(_this.$imageElement)
      .then(function(imageData) {
        _this.$imageElement.attr('src', imageData);
        _this.$imageElement.attr('imager-attached', true);
      })
      .fail(function(err) {
        console.error(err);
      });

    _this.$imageElement.on('load.imagerInit', function () {
      _this.$imageElement.off('load.imagerInit');
      _this.trigger('ready');
    });
  };

  /**
   * Prepares image after first loading. It checks image EXIF data and fixes it's rotation,
   * scales image down if it's too large.
   *
   * @param {HTMLImageElement} $image
   * @returns {jQuery.Deferred.<string>} Photo data base64 string
   */
  Imager.prototype.fixImageSizeAndRotation = function ($image) {
    // first of all we need to avoid HUGE problems that safari has when displaying
    // images that have exif orientation other than 1.
    // So first step is to remove any exif data from image.
    // Since we can do that only on base64 string  - here we check whether our image is a base64
    // encoded string. If yes - we can start right away. If not, we need to download it as data first using
    // XMLHttpRequest.

    var _this = this;
    var deferred = $.Deferred();

    var imageSrc = $image.attr('src');

    if(imageSrc.length < 1) {
      return $.when('');
    }
    else if (imageSrc.indexOf('data:image') === 0) {
      return this._fixBase64ImageSizeAndRotation(imageSrc);
    } else if (imageSrc.indexOf('http') === 0) {
      var xhr = new XMLHttpRequest();
      xhr.responseType = 'blob';
      xhr.onload = function () {
        var reader = new FileReader();
        reader.onloadend = function () {
          _this._fixBase64ImageSizeAndRotation(reader.result)
            .then(function (imageData) {
              deferred.resolve(imageData);
            });
        };
        reader.onerror = function (err) {
          deferred.reject(err);
        };
        reader.readAsDataURL(xhr.response);
      };
      xhr.open('GET', imageSrc);
      xhr.send();
      return deferred.promise();
    } else {
      console.error('Unsupported image `src`!');
      return $.when('');
    }
  };

  /**
   * Base64 image data could contain EXIF data which causes
   * @param imageBase64Data
   * @returns {*}
   * @private
   */
  Imager.prototype._fixBase64ImageSizeAndRotation = function (imageBase64Data) {
    var _this = this;
    var deferred = $.Deferred();

    var imageFormat = _this.getImageFormat(_this.$imageElement.attr('src'));

    if(imageFormat === 'jpeg' || imageFormat === 'jpg') {
      // first of all - get rid of any rotation in exif
      this.originalExif = piexif.load(imageBase64Data);
      var originalOrientation = this.originalExif['0th'][piexif.ImageIFD.Orientation];
      this.originalExif['0th'][piexif.ImageIFD.Orientation] = 1;
      imageBase64Data = piexif.insert(piexif.dump(this.originalExif), imageBase64Data);
    }

    var image = document.createElement('img');
    image.onload = imageLoaded;
    image.src = imageBase64Data;

    function imageLoaded() {
      var canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;

      var ctx = canvas.getContext('2d');

      if(imageFormat === 'jpeg' || imageFormat === 'jpg') {
        switch (originalOrientation) {
          case 2:
            // horizontal flip
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            break;
          case 3:
            // 180° rotate left
            ctx.translate(canvas.width, canvas.height);
            ctx.rotate(Math.PI);
            break;
          case 4:
            // vertical flip
            ctx.translate(0, canvas.height);
            ctx.scale(1, -1);
            break;
          case 5:
            // vertical flip + 90 rotate right
            canvas.width = image.naturalHeight;
            canvas.height = image.naturalWidth;

            ctx.rotate(0.5 * Math.PI);
            ctx.scale(1, -1);
            break;
          case 6:
            // 90° rotate right and flip canvas width and height
            canvas.width = image.naturalHeight;
            canvas.height = image.naturalWidth;

            ctx.translate(canvas.width, 0);
            ctx.rotate(0.5 * Math.PI);
            break;
          case 7:
            // horizontal flip + 90 rotate right

            canvas.width = image.naturalHeight;
            canvas.height = image.naturalWidth;

            ctx.rotate(0.5 * Math.PI);
            ctx.translate(canvas.width, -canvas.height);
            ctx.scale(-1, 1);
            break;
          case 8:
            // 90° rotate left
            canvas.width = image.naturalHeight;
            canvas.height = image.naturalWidth;

            ctx.rotate(-0.5 * Math.PI);
            ctx.translate(-canvas.width, 0);
            break;
        }
      }

      ctx.drawImage(image, 0, 0);

      if (canvas.width > _this.options.maxImageWidth) {
        var newWidth = _this.options.maxImageWidth;

        var scalePercent = _this.options.maxImageWidth * 100 / canvas.width;

        var newHeight = scalePercent * canvas.height / 100;

        _this.log('Photo is bigger than we could handle, resizing to', newWidth, newHeight);

        util.resizeImage(canvas,
          canvas.width, canvas.height, newWidth, newHeight);
      }

      deferred.resolve(canvas.toDataURL(_this.options.format));
    }

    return deferred.promise();
  };

  Imager.prototype.startSelector = function () {
    var _this = this;

    this.$selectorContainer = $(
      '<div class="imager-selector-container" tabindex="1"></div>'
    );

    var onImagerReady = function () {
      _this.off('ready', onImagerReady);

      _this.startEditing();
      _this.$selectorContainer.remove();
      _this.$selectorContainer = null;
    };

    var onImageLoad = function () {
      _this.$imageElement.off('load', onImageLoad);

      _this.handleImageElementSrcChanged();
      _this.on('ready', onImagerReady);
    };

    var fileSelector = new util.FileSelector('image/*');
    fileSelector.onFileSelected(function (file) {
      util.setWaiting(_this.$selectorContainer, translations.t('Please wait...'));

      setTimeout(function () {
        _this.$imageElement.attr('src', file.data);
        _this.$imageElement.css('height', 'auto');
        _this.$imageElement.css('min-height', 'inherit');
        _this.$imageElement.css('min-width', 'inherit');

        _this.$imageElement.on('load', onImageLoad);
      }, 200);
    });

    this.$selectorContainer.append(fileSelector.getElement());

    $('body').append(this.$selectorContainer);

    var imageOffset = this.$imageElement.offset();

    this.$selectorContainer.css({
      left: imageOffset.left,
      top: imageOffset.top,
      width: this.$imageElement.width(),
      height: this.$imageElement.height()
    });
  };

  Imager.prototype.startEditing = function () {
    this.log('startEditing()');

    this.hideOriginalImage();

    if (!this.$imageElement[0].complete) {
      throw new Error('Trying to start editing image that was not yet loaded. ' +
        'Please add `ready` event listener to imager.');
    }

    this.originalPreviewWidth = this.$imageElement.width();
    this.originalPreviewHeight = this.$imageElement.height();

    this.$editContainer = $(
      '<div class="imager-edit-container" tabindex="1"></div>'
    );

    if (this.options.editModeCss) {
      this.$editContainer.css(this.options.editModeCss);
    }

    $('body').append(this.$editContainer);

    this._createEditCanvas();

    this.adjustEditContainer();

    this.trigger('editStart');

    this.render();

    this._isInEditMode = true;

    this.$editContainer.focus();

    var sizeInBytes = this.getDataSize();
    if (sizeInBytes > this.options.imageSizeForPerformanceWarning) {
      util.setOverlayMessage(
        this.$editContainer,
        'Photo is too big and could cause very poor performance.',
        'default',
        'Ok',
        function () {
          util.removeOverlayMessage(this.$editContainer);
        }.bind(this));
    }

    this._adjustElementsSize('toolbar-button',
      this.touchDevice ?
        this.options.toolbarButtonSizeTouch :
        this.options.toolbarButtonSize
    );

    // clean up the history
    if (this.history.length === 0) {
      this.commitChanges('Original');
    }

    this.trigger('historyChange');
  };

  Imager.prototype.stopEditing = function () {
    if (!this._isInEditMode) {
      return;
    }

    this.showOriginalImage();

    this.render();

    var pluginsDataRaw = this.invokePluginsMethod('serialize');
    var pluginsData = {};
    $(pluginsDataRaw).each(function (i, d) {
      pluginsData[d.name] = d.result;
    });

    var imageData = null;

    try {
      imageData = this.canvas.toDataURL('image/' + this.options.format, this.quality);
    } catch (err) {
      if (err.name && err.name === 'SecurityError') {
        console.error('Failed to get image data from canvas because of security error.' +
          'Usually this happens when image drawed on canvas is located on separate domain without' +
          'proper access-control headers.');
      } else {
        console.error(err);
      }
    }

    if (!imageData) {
      console.error('Failed to get image data from canvas.');
    }

    // save current changes to image
    this.$imageElement.attr('src', imageData);

    this.$editContainer.remove();
    this.$editContainer = null;

    this.canvas = null;
    this.tempCanvas = null;

    this.trigger('editStop', {imageData: imageData, pluginsData: pluginsData});

    this._isInEditMode = false;
  };

  /**
   * Change the container's z-index property.
   *
   * @param zIndexValue
   */
  Imager.prototype.setZindex = function (zIndexValue) {
    if (this.$editContainer) {
      this.$editContainer.css('z-index', zIndexValue);
    }
  };

  /**
   * Stores current image to history, then renders current canvas into image.
   *
   * @param operationMessage
   */
  Imager.prototype.commitChanges = function (operationMessage, callback) {
    var _this = this;

    var originalQuality = this.quality;
    var originalTargetScale = this.targetScale;

    this.quality = 1;
    this.targetScale = 1;
    this.adjustCanvasSize();
    this.render();

    // save current canvas image to image element
    var imageData = this.canvas.toDataURL('image/' + this.options.format, 100);

    // set image loading handlers
    this.$imageElement.on('load', imageLoadHandler);
    this.$imageElement.on('error', onImageLoadError);

    // load image
    this.$imageElement.attr('src', imageData);

    function imageLoadHandler() {
      _this.$imageElement.off('load', imageLoadHandler);

      _this.quality = originalQuality;
      _this.targetScale = originalTargetScale;
      _this.adjustCanvasSize();

      _this.history.push({
        message: operationMessage,
        image: imageData,
        width: _this.$imageElement.width(),
        height: _this.$imageElement.height()
      });

      _this.originalPreviewWidth = _this.$imageElement.width();
      _this.originalPreviewHeight = _this.$imageElement.height();

      _this.render();
      _this.trigger('historyChange');

      if (callback && (callback instanceof Function)) {
        callback();
      }
    }

    function onImageLoadError(event) {
      console.warn('commitChanges() : image failed to load :', event);
      console.trace();
    }
  };

  Imager.prototype.isInEditMode = function () {
    return this._isInEditMode;
  };

  /**
   * Creates canvas for showing temporary edited image.
   * Created temporary canvas for drawing temporary data by plugins etc.
   *
   * Those canvases could be accessed as this.canvas and this.tempCanvas.
   *
   * @private
   */
  Imager.prototype._createEditCanvas = function () {
    var imageWidth = this.$imageElement.width();
    var imageHeight = this.$imageElement.height();

    var imageNaturalWidth = this.$imageElement[0].naturalWidth;
    var imageNaturalHeight = this.$imageElement[0].naturalHeight;

    var $canvas = $('<canvas class="imager-edit-canvas"/>');
    $canvas.css({
      width: imageWidth,
      height: imageHeight
    });

    this.canvas = $canvas[0];

    this.adjustCanvasSize();

    this.$editContainer.append($canvas);

    this.tempCanvas = document.createElement('canvas');
    this.tempCanvas.width = imageNaturalWidth;
    this.tempCanvas.height = imageNaturalHeight;

    if (this.showTemporaryCanvas) {
      $('body').append(this.tempCanvas);
      $(this.tempCanvas).css({
        position: 'absolute',
        left: '50px',
        top: '50px',
        width: imageWidth
      });
    }
  };

  /**
   * Renders image on temporary canvas and then invokes plugin methods
   * that shoul modify image.
   *
   * @param [ctx] Context on which to draw image.
   */
  Imager.prototype.render = function (ctx) {
    ctx = ctx !== undefined ? ctx : this.canvas.getContext('2d');

    var realWidth = this.$imageElement[0].naturalWidth;
    var realHeight = this.$imageElement[0].naturalHeight;

    if (realWidth === 0 || realHeight === 0) {
      console.warn('Trying to render canvas with zero width or height');
      console.trace();
      return;
    }

    // reset canvas size to image natural size
    ctx.canvas.width = realWidth * this.targetScale;
    ctx.canvas.height = realHeight * this.targetScale;

    this.tempCanvas.width = realWidth;
    this.tempCanvas.height = realHeight;

    var destWidth = ctx.canvas.width;
    var destHeight = ctx.canvas.height;

    var viewPort = {
      sourceLeft: 0,
      sourceTop: 0,
      sourceWidth: realWidth,
      sourceHeight: realHeight,
      destLeft: 0,
      destTop: 0,
      destWidth: destWidth,
      destHeight: destHeight,
      paddingWidth: 0,
      paddingHeight: 0
    };

    this.drawImage(this.$imageElement, ctx, viewPort);

    this.invokePluginsMethod('render', ctx);
  };

  Imager.prototype.clearCanvas = function (ctx) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (this.options.format == 'jpeg') {
      ctx.fillStyle = "#FFFFFF"; // jpeg does not support transparency
                                 // so without this line all non painted areas will be black.
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  };

  Imager.prototype.drawImage = function ($img, ctx, viewPort) {
    if (ctx.canvas.width === 0 || ctx.canvas.height === 0) {
      console.warn('Imager.drawImage() : Trying to render canvas with either width or height equal to 0');
      return;
    }

    this._drawWithScaling($img, ctx, this.tempCanvas.getContext('2d'),
      viewPort.sourceLeft, viewPort.sourceTop,
      viewPort.sourceWidth, viewPort.sourceHeight,

      viewPort.destLeft, viewPort.destTop,
      viewPort.destWidth, viewPort.destHeight,

      viewPort.paddingWidth, viewPort.paddingHeight
    );
  };

  /**
   * Draws image on canvas with specified dimensions.
   * Drawing is performed in few steps to make image smooth.
   *
   * More information about interpolation here:
   * http://stackoverflow.com/questions/17861447/html5-canvas-drawimage-how-to-apply-antialiasing
   *
   * @param {HTMLImageElement} $img Photo to draw
   * @param ctx           Canvas context to draw on
   * @param tempCtx       Temporary canvas context to draw on interpolation steps
   * @param sourceLeft    Source image x coordinate
   * @param sourceTop     Source image y coordinate
   * @param sourceWidth   Source image width
   * @param sourceHeight  Source image height
   * @param destLeft      Destination image x coordinate
   * @param destTop       Destination image y coordinate
   * @param destWidth     Destination image width
   * @param destHeight    Destination image height
   * @param paddingWidth  Width padding that will be applied to target image
   * @param paddingHeight Height padding that will be applied to target image
   * @private
   */
  Imager.prototype._drawWithScaling = function ($img, ctx, tempCtx,
                                                sourceLeft, sourceTop,
                                                sourceWidth, sourceHeight,
                                                destLeft, destTop,
                                                destWidth, destHeight,
                                                paddingWidth, paddingHeight) {

    paddingWidth = paddingWidth !== undefined ? paddingWidth : 0;
    paddingHeight = paddingHeight !== undefined ? paddingHeight : 0;

    sourceLeft = sourceLeft !== undefined ? sourceLeft : 0;
    sourceTop = sourceTop !== undefined ? sourceTop : 0;

    var paddingWidthHalf = paddingWidth / 2;
    var paddingHeightHalf = paddingHeight / 2;

    var tempCanvas = tempCtx.canvas;

    tempCtx.clearRect(0, 0, sourceWidth, sourceHeight);

    var img = $img[0];

    var steps = 3;

    var step = 0.5;

    var currentStepWidth = sourceWidth;
    var currentStepHeight = sourceHeight;

    var currentStepSourceLeft = sourceLeft;
    var currentStepSourceTop = sourceTop;

    tempCtx.drawImage(img,
      currentStepSourceLeft, currentStepSourceTop,
      sourceWidth, sourceHeight,
      0, 0, currentStepWidth, currentStepHeight);

    for (var s = 0; s < steps; s++) {
      if (currentStepWidth <= destWidth * 2 ||
        currentStepHeight <= destHeight * 2) {
        break;
      }

      var prevStepWidth = currentStepWidth;
      var prevStepHeight = currentStepHeight;

      currentStepWidth *= step;
      currentStepHeight *= step;

      currentStepSourceLeft *= step;
      currentStepSourceTop *= step;

      var stepTempCanvas = document.createElement('canvas');
      stepTempCanvas.width = tempCtx.canvas.width;
      stepTempCanvas.height = tempCtx.canvas.height;

      var stepTempCtx = stepTempCanvas.getContext('2d');
      stepTempCtx.clearRect(0, 0, stepTempCanvas.width, stepTempCanvas.height);

      stepTempCtx.drawImage(tempCanvas,
        currentStepSourceLeft, currentStepSourceTop, prevStepWidth, prevStepHeight,
        0, 0, currentStepWidth, currentStepHeight);

      tempCtx.clearRect(0, 0, tempCtx.canvas.width, tempCtx.canvas.height);

      tempCtx.drawImage(stepTempCanvas,
        0, 0, currentStepWidth, currentStepHeight,
        0, 0, currentStepWidth, currentStepHeight
      );
    }

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    ctx.drawImage(tempCanvas,
      0, 0, currentStepWidth, currentStepHeight,
      destLeft + paddingWidthHalf, destTop + paddingHeightHalf,
      destWidth - paddingWidth, destHeight - paddingHeight
    );
  };

  /**
   * Sets preview area dimensions.
   * Note that this affects only the size of image that user sees.
   * Internal image size is not affected.
   *
   * @param {number} width
   * @param {number} height
   */
  Imager.prototype.setPreviewSize = function (width, height) {
    this.$imageElement.css({
      width: width,
      height: height
    });

    $(this.canvas).css({
      width: width,
      height: height
    });

    $('body').trigger('imagerResize');
    this.log('resize trigger');

    this.originalPreviewWidth = this.$imageElement.width();
    this.originalPreviewHeight = this.$imageElement.height();
  };

  Imager.prototype.getPreviewSize = function () {
    return {
      width: this.$imageElement.width(),
      height: this.$imageElement.height()
    };
  };

  Imager.prototype.getImageRealSize = function () {
    return {
      width: this.$imageElement[0].naturalWidth,
      height: this.$imageElement[0].naturalHeight
    };
  };

  Imager.prototype.getCanvasSize = function () {
    return {
      width: this.canvas.width,
      height: this.canvas.height
    };
  };

  Imager.prototype.convertScale = function (value, sourceMax, targetMax) {
    var valueInPercents = value * 100 / sourceMax;

    return valueInPercents * targetMax / 100;
  };

  Imager.prototype.hideOriginalImage = function () {
    this.$imageElement.css('opacity', 0);
  };

  Imager.prototype.showOriginalImage = function () {
    this.$imageElement.css('opacity', 1);
  };

  /**
   * Takes image's real size (naturalWidth & naturalHeight)
   * and adjust canvas size to match that
   * but with respect to aspect ratio of preview viewport size.
   */
  Imager.prototype.adjustCanvasSize = function () {
    var imageRealSize = this.getImageRealSize();
    var previewSize = this.getPreviewSize();

    var newCanvasWidth = 0;
    var newCanvasHeight = 0;

    var aspectRatio = 0;

    if (previewSize.width > previewSize.height) {
      newCanvasWidth = imageRealSize.width;

      aspectRatio = previewSize.height * 100 / previewSize.width;
      newCanvasHeight = aspectRatio * newCanvasWidth / 100;
    }
    else {
      newCanvasHeight = imageRealSize.height;

      aspectRatio = previewSize.width * 100 / previewSize.height;
      newCanvasWidth = aspectRatio * newCanvasHeight / 100;
    }

    this.canvas.width = newCanvasWidth * this.targetScale;
    this.canvas.height = newCanvasHeight * this.targetScale;

    // if canvas size limit is set - check canvas size
    this.canvasSizeLimit = 1 * 1024 * 1024;
    if (this.canvasSizeLimit) {
      if (this.canvas.width * this.canvas.height > this.canvasSizeLimit) {
        console.warn('adjustCanvasSize(): canvas size is too big : ', this.canvas.width, this.canvas.height);
        var ratio = 0.95 * this.canvasSizeLimit / (this.canvas.width * this.canvas.height);

        this.canvas.width = this.canvas.width * ratio;
        this.canvas.height = this.canvas.height * ratio;
        console.warn('adjustCanvasSize(): canvas was reduced to : ', this.canvas.width, this.canvas.height);
      }
    }

  };

  /**
   * Positions $editContained with absolute coordinates
   * to be on top of $imageElement.
   */
  Imager.prototype.adjustEditContainer = function () {
    var _this = this;

    var imageOffset = _this.$imageElement.offset();

    if (_this.$editContainer) {
      _this.$editContainer.css({
        left: imageOffset.left,
        top: imageOffset.top,
        width: _this.$imageElement.width(),
        height: _this.$imageElement.height()
      });
    }

    if (_this.$selectorContainer) {
      _this.$selectorContainer.css({
        left: imageOffset.left,
        top: imageOffset.top,
        width: this.$imageElement.width(),
        height: this.$imageElement.attr('src') ? this.$imageElement.height() : 'auto'
      });
    }
  };

  Imager.prototype.restoreOriginal = function () {
    this.$imageElement.replaceWith(this.$originalImage);
  };

  Imager.prototype.historyUndo = function () {
    if (this.history.length < 2) {
      return;
    }

    var _this = this;

    var lastEntry = this.history[this.history.length - 2];

    this.$imageElement.on('load', imageLoadHandler);
    this.$imageElement.attr('src', lastEntry.image);

    this.$imageElement.width(lastEntry.width);
    this.$imageElement.height(lastEntry.height);

    function imageLoadHandler() {
      _this.$imageElement.off('load', imageLoadHandler);

      _this.originalPreviewWidth = _this.$imageElement.width();
      _this.originalPreviewHeight = _this.$imageElement.height();

      _this.setPreviewSize(lastEntry.width, lastEntry.height);

      _this.render();
      _this.history.splice(_this.history.length - 1, 1);

      _this.trigger('historyChange');
    }
  };

  Imager.prototype.remove = function (removeImage) {
    this.trigger('remove');

    this.$imageElement.removeAttr('imager-attached');
    this.stopEditing();
    this.showOriginalImage();
    var index = imagerInstances.indexOf(this);
    imagerInstances.splice(index, 1);

    this.$originalImage = null;
    this.pluginsInstances = null;

    if (removeImage) {
      this.$imageElement.remove();
    }
  };

  /**
   * Returns current image data in bytes.
   *
   * @returns {number} Bytes number
   */
  Imager.prototype.getDataSize = function () {
    var head = 'data:' + 'image/' + this.options.format + ';base64,';
    var data = this.canvas.toDataURL('image/' + this.options.format, this.quality);

    var size = Math.round((data.length - head.length) * 3 / 4);

    return size;
  };

  /**
   * Tries to find Imager instance associated with provided img element.
   *
   * @param $img {HTMLImageElement|jQuery}
   * @returns {Imager|undefined}
   */
  Imager.getImagerFor = function ($img) {
    for (var i = 0; i < imagerInstances.length; i++) {
      var imager = imagerInstances[i];

      if (imager.id == $($img).attr('data-imager-id')) {
        return imager;
      }
    }

    return undefined;
  };

  Imager.isImagerAttached = function ($elem) {
    return $($elem).attr('imager-attached') !== undefined;
  };

  /**
   * @param {boolean} waiting Waiting status. TRUE for adding 'waiting' text,
   * false to remove.
   */
  Imager.prototype.setWaiting = function (waiting) {
    if (waiting) {
      if (this.$editContainer) {
        util.setWaiting(
          this.$editContainer, translations.t('Please wait...'),
          this.options.waitingCursor
        );
      }
    } else {
      util.stopWaiting(this.$editContainer);
    }
  };

  /**
   * Detects image format for either base64 encoded string or http:// url.
   * @param {string} imageSrc
   */
  Imager.prototype.getImageFormat = function (imageSrc) {
    if (!imageSrc) {
      return;
    }

    var extension;

    if (imageSrc.indexOf('http') === 0) {
      extension = imageSrc.split('.').pop();

      if (extension == 'jpeg') {
        extension = 'jpeg';
      } else if (extension == 'jpg') {
        extension = 'jpeg';
      } else if (extension == 'png') {
        extension = 'png';
      }
    } else if (imageSrc.indexOf('data:image') === 0) {
      if (imageSrc[11] == 'j') {
        extension = 'jpeg';
      } else if (imageSrc[11] == 'p') {
        extension = 'png';
      }
    }

    return extension;
  };

  /**
   * This method allows dynamical size adjustment of elements.
   * Elements which needs to be resized should have two attributes:
   *
   * data-sizeable="someNamespace",
   * where someNamespace is unique id for the group of elements tht will be
   * resized together.
   *
   * data-cssrules=width,height,font-size:($v / 2.5)
   * which provides a list of css rules on which a new size will be applied.
   * If resulting size needs to be modififed in some way, the one could
   * specify a function like in font-size.
   *
   * @private
   */
  Imager.prototype._adjustElementsSize = function (namespace, newSize) {
    var elementsToResize =
      $('[data-sizeable=' + namespace + ']');

    for (var i = 0; i < elementsToResize.length; i++) {
      var elem = elementsToResize[i];
      var attributesToChange = $(elem)
        .attr('data-cssrules')
        .split(',');

      for (var a = 0; a < attributesToChange.length; a++) {
        var attrName = attributesToChange[a];
        var attrVal = newSize;

        if (attrName[0] == '-') {
          attrName = attrName.substr(1);
          attrVal = '-' + newSize;
        }

        var matches = attrName.match(/:\((.+)\)/);
        if (matches) {
          attrName = attrName.replace(matches[0], '');
          var expression = matches[1];
          expression = expression.replace('$v', attrVal);
          var result = new Function("return " + expression)();
          attrVal = result;
        }

        $(elem).css(attrName, attrVal + 'px');
      }
    }
  };

  /**
   * Crude detection of device and platform.
   * Sets this.platform and this.touchDevice.
   * @todo this is BAD. Use more precise methods or some lib
   */
  Imager.prototype.detectPlatform = function () {
    // crude check of platform
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      this.platform = PLATFORM.ios;
    } else if (/Android|BlackBerry/i.test(navigator.userAgent)) {
      this.platform = PLATFORM.android;
    } else if (/IEMobile/i.test(navigator.userAgent)) {
      this.platform = PLATFORM.windowsMobile;
    }

    // check if options.detectTouch is function
    if (this.options.detectTouch && (this.options.detectTouch.constructor.name !== 'Function')) {
      console.error('detectTouch should be a function which will be ' +
        'called when Imager needs to determine whether it is working ' +
        'on touch device');
      this.options.detectTouch = null;
    }

    // crude check of touch
    if (this.options.detectTouch) {
      this.touchDevice = this.options.detectTouch(this);
    } else {
      this.touchDevice = /(iPhone|iPod|iPad|BlackBerry|Android)/i.test(navigator.userAgent);
    }

    // one more touch check
    var _this = this;
    $('body').on('touchstart.DrawerTouchCheck', function () {
      _this.touchDevice = true;
      $('body').off('touchstart.DrawerTouchCheck');
      _this.log('Found touch screen.');
    });
  };


  namespace.Imager = Imager;

})(jQuery, ImagerJs, ImagerJs.plugins, ImagerJs.util, ImagerJs.translations);
