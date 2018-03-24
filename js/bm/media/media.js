
BM.Media = (function() {
	var _mediaScope = null;
	var _lightboxScope = null;
	var _uploadDialog = $('#media-upload-dialog');
	var _uploadDialogShowing = false;

	/* Dropzone */
	var _dropzoneContainer = $('#media-dropzone-container');
	var _dropzoneElement = $('#media-dropzone');
	var _dropzone = null;
	var _acceptedFiles = "image/*,video/*";
	var _maxFiles = 50;
	var _maxFileSize = 10;

	/* Upload progress */
	var _progressFile = $('#media-upload-progress-file');
	var _progressTotal = $('#media-upload-progress-total');
	var _totalBytesToSend = 0;		// Used to keep track of the upload percentage completion
	var _totalBytesSent = 0;
	var _totalFilesToUpload = 0;
	var _totalFilesSuccessful = 0;

	/* Media reel */
	var _isSending = false;			// If a dropzone send operation is in progress
	var _mediaReelMaxImages = 50;
	var _mediaReelRequeryEnabled = false;
	var _currentMediaXHRRequest = null;
	var _mediaReelItems = [];
	var _lightboxItems = [];		// Processed media reel items, ready for passing to the lightGallery library
	var _mediaReel = $('#media-reel');
	var _guidanceLine = new BM.GuidanceLine(null, null, [-5, 18], 'rgba(0, 0, 0, 0.8)', 'rgba(255, 255, 255, 0.6)');

	/* Lightbox media information sidebar */
	var _lightboxSidebar = $('#media-lightbox-sidebar');

	/** @type {ol.Feature} */
	var _selectionMarkerFeature = null;

	/** @type {ol.layer.Vector} */
	var _selectionMarkerLayer = null;

	/** @type {ol.interaction.Translate} */
	var _selectionMarkerInteraction = null;

	BM.angularApp.controller('mediaController', ['$scope', '$http', '$log', '$timeout', function($scope, $http, $log, $timeout) {
		_mediaScope = $scope;
		$scope.currentUploadStep = 1;
		$scope.locationOption = 0;
		$scope.locationSelected = false;
		$scope.selectedMarker = null;
		$scope.selectedPoint = null;
		$scope.commonProperties = {
			dateTaken: { enabled: true, value: null },
			attribution: { enabled: true, value: '' },
			tags: { enabled: true, value: '' },
			description: { enabled: false, value: '' }
		};

		$scope.mediaUploadItems = [];
		$scope.uploadErrors = [];

		$('body').on('bm:incidentmarker.selected', function(event) {
			$scope.selectedMarker = event.feature;
			$scope.locationSelected = true;
			$scope.$apply();
		}).on('bm:incidentmarker.deselected', function(event) {
			$scope.selectedMarker = null;
			$scope.locationSelected = false;
			$scope.$apply();
		}).on('bm:location.pickchange', function(event) {
			// Updates the lat/lon coords in the dialog when the user changes the position of the location selector
			$scope.selectedPoint = ol.proj.toLonLat(event.coordinate);
			$scope.locationSelected = true;
			$scope.$apply();
		});

		/**
		 * Determines whether the 'Next' button is enabled for the current step
		 * @returns {boolean}
		 */
		$scope.nextButtonEnabled = function()
		{
			switch($scope.currentUploadStep)
			{
				case 1:
					return $scope.mediaUploadItems.length > 0;
				case 2:
					return $scope.locationOption > 0 && $scope.locationSelected || $scope.locationOption === 3;
				case 3:
					return $scope.mediaUploadProperties.$valid;
				case 4:
					return $scope.uploadErrors.length > 0;
					break;
			}
		};

		/**
		 * @returns {boolean}
		 */
		$scope.backButtonEnabled = function()
		{
			return $scope.currentUploadStep < 4;
		};

		/**
		 * Displays the next step UI
		 */
		$scope.nextUploadStep = function()
		{
			if ($scope.nextButtonEnabled())
				$scope.currentUploadStep++;

			$scope.uploadStepChanged();
		};

		$scope.prevUploadStep = function()
		{
			if ($scope.currentUploadStep > 1)
				$scope.currentUploadStep--;

			$scope.uploadStepChanged();
		};

		$scope.uploadStepChanged = function()
		{
			if ($scope.currentUploadStep === 2)
				$scope.selectLocationOption(true);
			else
				$scope.selectLocationOption(false);

			if ($scope.currentUploadStep === 4)
			{
				// Upload all queued items. Status will be updated as uploads occur
				$timeout(function() {
					_processDropzoneQueue();
				});
			}
			else if($scope.currentUploadStep > 4)
			{
				// Upload completed with errors. The user was given the opportunity to review the errors and
				// manually clicked the 'Close' button in the progress window.
				$scope.cancelUpload();
			}
		};

		/**
		 * Cancel the upload and restart at step 1 next time it is invoked
		 */
		$scope.cancelUpload = function()
		{
			_closeUploadDialog();

			$scope.currentUploadStep = 1;
			$scope.locationOption = 0;
			$scope.locationSelected = false;
			$scope.selectedMarker = null;
			$scope.selectedPoint = null;
			$scope.commonProperties = {
				dateTaken: {enabled: true, value: null},
				attribution: {enabled: true, value: ''},
				tags: {enabled: true, value: ''},
				description: {enabled: false, value: ''}
			};

			$scope.mediaUploadItems = [];
			$scope.uploadErrors = [];

			$timeout(function() {
				_dropzone.removeAllFiles(true);
				_resetUploadProgressBars();
				_endLocationSelection();
			});
		};

		$scope.confirmCancelUpload = function()
		{
			if ($scope.mediaUploadItems.length > 0)
			{
				var confirmationDialog = $('#dialog-confirm-media-upload-cancellation');

				if (!confirmationDialog.dialog('instance'))
				{
					confirmationDialog.dialog({
						title: 'Cancel Media Upload',
						modal: true,
						show: {
							effect: 'fade',
							duration: 200
						},
						hide: {
							effect: 'fade',
							duration: 200
						},
						buttons: [{
							text: 'Resume',
							class: 'default',
							click: function() {
								$(this).dialog('close');
							}
						}, {
							text: 'Cancel Upload',
							click: function() {
								$(this).dialog('close');
								$scope.cancelUpload();
							}
						}]
					});
				}
				else
				{
					confirmationDialog.dialog('open');
				}
			}
			else
			{
				$scope.cancelUpload();
			}
		};

		$scope.uploadCompleted = function()
		{
			if ($scope.uploadErrors.length === 0)
			{
				$scope.cancelUpload();
				InfoDialog(
					'Upload Completed',
					'<p>You have successfully submitted your media files. They are now awaiting moderation by the website team.</p>' +
					'<p>If they are approved, site visitors will be able to find them by either opening the incident marker you attached them to,' +
					'or centering the map near the location you nominated.</p>');

				_requeryMediaReel();

				// Notify any media layers to update
				$('body').trigger($.Event('bm:media.uploadcompleted'));
			}
			else
			{
				var firstSentence;
				if (_totalFilesSuccessful === 0)
					firstSentence = 'All ' + _totalFilesToUpload;
				else
					firstSentence = $scope.uploadErrors.length + ' out of ' + _totalFilesToUpload;

				var errorBody = '<p>' + firstSentence + ' files failed to upload. A list of the failed files is displayed in the progress window.</p>' +
					'<p>Please <a href="/contact/" target="_blank">contact the website team</a> and provide this list, to aid troubleshooting.</p>';

				if (_totalFilesSuccessful > 0)
					errorBody += '<p>The other ' + _totalFilesSuccessful + ' files uploaded successfully and are awaiting moderation by the website team. Please do NOT resubmit these files.';

				InfoDialog('Errors Occurred', errorBody);
			}
		};

		$scope.$watch('locationOption', function(option, prevOption)
		{
			// Hide selection button tooltips
			_uploadDialog.find('.step.location').find('.selectable').tooltipster('hide');
			$scope.selectLocationOption(true);
		});

		$scope.selectLocationOption = function(enable)
		{
			if ($scope.locationOption === 1 || !enable)
			{
				// User completed picking, so restore layer visiblity and interaction
				_hideLocationSelectionMarker();

				if (BM.MarkerPanel.getSelectedMarker())
					$scope.selectedMarker = BM.MarkerPanel.getSelectedMarker();

				$scope.locationSelected = ($scope.selectedMarker != null);
			}
			else if($scope.locationOption === 2)
			{
				// User has just switched to 'Point on Map' option
				// Notify layers that the user is picking a location
				$('body').trigger($.Event('bm:location.pickstart'));
				_selectionMarkerInteraction.setActive(true);
				_selectionMarkerLayer.setVisible(true);

				$scope.locationSelected = ($scope.selectedPoint != null);
			}
			else if($scope.locationOption === 3)
			{
				_hideLocationSelectionMarker();
			}
		};

		$scope.dropzoneItemsChanged = function()
		{
			$scope.mediaUploadItems = _dropzone.getQueuedFiles().concat(_dropzone.getAddedFiles());

			// Retrieve markup for the preview image, for display in the metadata entry step
			$.each($scope.mediaUploadItems, function(i, item) {
				item.previewImage = $(item.previewElement).find('div.dz-image').prop('outerHTML');
			});

			$scope.$apply();
		};

		/**
		 * Appends metadata fields to a form in preparation for DropzoneJS to send it to the server.
		 * This method is called for each file being uploaded (event: sending).
		 * @param formData
		 * @param file
		 */
		$scope.attachFileMeta = function(formData, file)
		{
			if (formData && file)
			{
				// Selected marker ID and/or position
				if ($scope.locationOption === 1 && $scope.selectedMarker)
				{
					// TODO: In future, will need to accommodate different layer types and include a layer ID to contextualise the incident ID

					// TODO: Fix hard coded reference to 'markerID' - need to query the markerIdKey used by the marker's layer class
					formData.append('featureID', $scope.selectedMarker.get('markerID'));
					formData.append('location', ol.proj.toLonLat($scope.selectedMarker.getGeometry().getCoordinates()));
				}
				else if($scope.locationOption === 2 && $scope.selectedPoint)
				{
					formData.append('location', $scope.selectedPoint);
				}
				else
				{
					formData.append('location', null);
				}

				// For each uploaded item, check whether common properties were applied and if not,
				// attach the individual item properties
				if ($scope.commonProperties.dateTaken.enabled)
					formData.append('dateTaken', $scope.commonProperties.dateTaken.value);
				else if(file.dateTaken)
					formData.append('dateTaken', file.dateTaken);

				if ($scope.commonProperties.attribution.enabled)
					formData.append('attribution', $scope.commonProperties.attribution.value);
				else if(file.attribution)
					formData.append('attribution', file.attribution);

				if ($scope.commonProperties.tags.enabled)
					formData.append('tags', $scope.commonProperties.tags.value);
				else if(file.tags)
					formData.append('tags', file.tags);

				if ($scope.commonProperties.description.enabled)
					formData.append('description', $scope.commonProperties.description.value);
				else if(file.description)
					formData.append('description', file.description);
			}
		};

		/**
		 * Appends an entry to the list of errors on the upload progress screen
		 * @param {string} title
		 * @param {string} body
		 */
		$scope.logUploadError = function(title, body)
		{
			$scope.uploadErrors.push({
				title: title,
				body: body
			});

			$scope.$apply();
		}
	}]).controller('mediaLightboxController', ['$scope', '$http', '$log', 'BM.services.utility', function($scope, $http, $log, utilityServices) {
		_lightboxScope = $scope;

		$scope.mediaInfo = undefined;
		$scope.tags = [];
		$scope.utilityServices = utilityServices;

		$scope.openMediaItem = function(itemProperties)
		{
			$scope.mediaInfo = itemProperties;
			$scope.tags = $scope.mediaInfo._source.Tags;
			$scope.$apply();

			// Increment the media record's view counter
			if (itemProperties)
				BM.ActivityLogging.logEvent(BM.LogEventTypes.openedMediaItem, itemProperties._id);
		};

		/**
		 * Number of times this user has 'liked' the media item
		 */
		$scope.ownLikeCount = function()
		{
			var likes;

			if ($scope.mediaInfo)
			{
				likes = $scope.mediaInfo._source.Likes;
				if (likes)
					likes = likes.filter(function(like) { return like.User.ID === BM.currentWPUser.ID; });
			}

			return likes ? likes.length : 0;
		};

		$scope.userLikesCaption = function()
		{
			if ($scope.mediaInfo)
			{
				var likes = $scope.mediaInfo._source.Likes;
				if (likes)
					likes = likes.filter(function(like) { return like.Timestamp !== undefined; }).length;

				if (!likes)
					return "0 likes so far";
				else if (likes === 1)
					return "1 user likes this";
				else if (likes > 1)
					return likes + " users like this";
			}
		};

		$scope.likeMediaItem = function()
		{
			$.post('/php/bm/record-user-media-like.php', {
				mediaID: $scope.mediaInfo._id
			}, function(data) {
				if (data)
				{
					$scope.mediaInfo._source.Likes.push(data);
					$scope.$apply();
					_requeryMediaReel();
				}
			});
		};

		$scope.description = function()
		{
			if ($scope.mediaInfo)
				return $scope.mediaInfo._source.Description ? $scope.mediaInfo._source.Description.replace(/\\"/g, "\"") : '';
			else
				return '';
		};

		$scope.creationDate = function()
		{
			if ($scope.mediaInfo)
				return moment($scope.mediaInfo._source.Created).calendar();
			else
				return '';
		};
	}]);

	function _init()
	{
		_uploadDialog.find('.step.location').find('.selectable').tooltipster({
			maxWidth: 250
		});

		_uploadDialog.resizable({
			handles: 'e, s, se'
		});

		_uploadDialog.on('resize', function (event, ui) {
			event.stopPropagation();
			_dropzoneContainer.css('max-height', ui.size.height);
			$('#media-upload-meta-entry-container').css('max-height', ui.size.height);

			// Update the max width of the filename
			var filename = _dropzoneElement.find('.dz-filename');
			var removeButton = _dropzoneElement.find('.dz-remove');

			if (filename.length > 0 && removeButton.length > 0)
			{
				var width = removeButton.offset().left - filename.offset().left;
				filename.css('max-width', width - 5);
			}
		});

		$('#media-upload-button').on('click', function()
		{
			if (BM.currentWPUser.ID > 0)
			{
				if (_uploadDialogShowing)
					_closeUploadDialog();
				else
					_openUploadDialog();
			}
			else
			{
				RedirectToLoginPage();
			}
		}).tooltipster({
			position: 'right'
		});

		// Ensure dialog fits within smaller displays
		$(window).on('resize', function() {
			var leftContainerHeight = $('#left-container').height();
			_uploadDialog.css({
				maxHeight: leftContainerHeight - _uploadDialog.offset().top - 5
			});

			// Resizable component has issues with changed dimensions on window resize, so recreate it
			_uploadDialog.resizable('destroy').resizable({
				handles: 'e, s, se'
			});

			_dropzoneContainer.mCustomScrollbar('update');

			// Resize the lightbox if it exists
			var lightGallery = $('div.media-lightgallery').find('.lg');
			if (lightGallery.length > 0)
				lightGallery.css('width', _getLightboxWidth());
		});

		_initDropzone();
		_initLocationSelection();
		_initSelectionMarkerLayer();
		_initMetadataFields();
		_initUploadProgress();
		_initMediaReel();
	}

	function _openUploadDialog()
	{
		if (!_uploadDialogShowing)
		{
			$('#media-upload-button')
				.addClass('active')
				.tooltipster('hide');

			_uploadDialog.show({
				effect: 'slide',
				direction: 'left',
				duration: 200,
				easing: 'easeInOutQuint'
			});

			_uploadDialogShowing = true;
		}
	}

	function _closeUploadDialog()
	{
		if (_uploadDialogShowing)
		{
			$('#media-upload-button')
				.removeClass('active')
				.tooltipster('hide');

			_uploadDialog.hide({
				effect: 'slide',
				direction: 'left',
				duration: 200,
				easing: 'easeInOutQuint'
			});

			_uploadDialogShowing = false;
		}
	}

	function _initDropzone()
	{
		// If an administrator or editor, remove limit on the number of files that can be uploaded and allow larger files to be sent (value is in MB)
		if (BM.currentWPUser.administrator || BM.currentWPUser.editor)
		{
			_maxFiles = null;
			_maxFileSize = 100;
		}

		_dropzone = new Dropzone("#media-dropzone", {
			url: '/php/bm/upload-incident-media.php',
			acceptedFiles: _acceptedFiles,
			maxFiles: _maxFiles,
			maxFilesize: 50,
			maxThumbnailFilesize: 50,
			thumbnailWidth: 100,
			thumbnailHeight: 100,
			autoProcessQueue: false,
			addRemoveLinks: true,
			dictDefaultMessage: 'Drop files here to upload',
			dictInvalidFileType: 'Invalid file type',
			dictFileTooBig: 'File too large. Max size: {{maxFilesize}} MB.',
			previewTemplate: $('#media-dropzone-template').html(),
			accept: function(file, done) {
				var readyMessage = $(file.previewElement).find('.dz-ready-message');
				readyMessage.fadeIn(400, function() {
					HideTinyLoadingIndicator($(file.previewElement).find('.loading-spinner'));
				});

				// If no thumbnail was loaded, use a placeholder appropriate for the file's MIME type
				var thumbnailImg = $(file.previewElement).find('.dz-image > img');
				if (thumbnailImg.prop('src') == '')
				{
					var isImage = _isSupportedImageMimeType(file.type);
					var isVideo = _isSupportedVideoMimeType(file.type);

					if (isImage)
						thumbnailImg.prop('src', '/images/Image-Placeholder.png');
					else if(isVideo)
						thumbnailImg.prop('src', '/images/Video-Placeholder.png');
				}

				_mediaScope.dropzoneItemsChanged();
				done();
			}
		});

		_dropzone
			.on('addedfile', function(file) {
				DisplayTinyLoadingIndicator($(file.previewElement).find('.loading-spinner'));
			})
			.on('removedfile', function(file) {
				_mediaScope.dropzoneItemsChanged();
			})
			.on('thumbnail', function(file, dataUrl) {
				_mediaScope.dropzoneItemsChanged();
			})
			.on('sending', function(file, xhr, formData) {
				_isSending = true;
				_totalFilesToUpload = _dropzone.getAcceptedFiles().length;
				_totalFilesSuccessful = 0;
				_mediaScope.attachFileMeta(formData, file);
			})
			.on('uploadprogress', function(file, percent, bytesSent) {
				_setFileUploadProgress(file, percent, bytesSent);
			})
			.on('totaluploadprogress', function(percent, bytesRemaining, totalBytesSent) {
				_setTotalUploadProgress(100 * _totalBytesSent / _totalBytesToSend, bytesRemaining, _totalBytesSent);
			})
			.on('success', function(file) {
				_isSending = false;

				// Keep processing the queue until all items are uploaded
				if (_dropzone.getQueuedFiles().length > 0)
					_dropzone.processQueue();

				_totalBytesSent += file.upload.total;
				_totalFilesSuccessful++;
			})
			.on('error', function(file, errorMessage, xhr) {
				if (_isSending)
				{
					_mediaScope.logUploadError(file.name, errorMessage);

					// Keep processing the queue until all items are uploaded
					if (_dropzone.getQueuedFiles().length > 0)
						_dropzone.processQueue();
				}
				else
				{
					HideTinyLoadingIndicator($(file.previewElement).find('.loading-spinner'));
				}
			})
			.on('queuecomplete', function() {
				if (_totalFilesToUpload > 0)
				{
					_setTotalUploadProgress(100, 0, _totalBytesSent);
					_mediaScope.uploadCompleted();
					_isSending = false;
				}
			});

		_dropzoneContainer.mCustomScrollbar({
			autoHideScrollbar: true,
			scrollInertia: 200,
			mouseWheel: {
				scrollAmount: 100
			},
			theme: 'minimal-dark',
			advanced: {
				updateOnContentResize: true
			}
		});
	}

	function _processDropzoneQueue()
	{
		// Calculate the number of bytes that will be sent.
		// This overcomes an issue with DropzoneJS, where the 'totaluploadprogress' method does not calculate the percentage correctly.
		var uploadQueue = _dropzone.getQueuedFiles();
		_totalBytesToSend = 0;
		_totalBytesSent = 0;
		for(var i = 0; i < uploadQueue.length; i++) {
			_totalBytesToSend += uploadQueue[i].upload.total;
		}

		_dropzone.processQueue();
	}

	function _initLocationSelection()
	{
		$('#map-drop-target-overlay').droppable({
			accept: '#map-location-selection-marker',
			hoverClass: 'dragging',
			tolerance: 'pointer',
			drop: function(event, ui) {
				var point = _selectionMarkerFeature.getGeometry();
				var coords = BM.map.getCoordinateFromPixel([event.offsetX, event.offsetY]);
				point.setCoordinates(coords);
				_selectionMarkerFeature.set('visible', true);

				$('body').trigger($.Event('bm:location.pickchange', {
					coordinate: coords
				}));
			}
		});

		var locationSelectionMarker = $('#map-location-selection-marker');
		locationSelectionMarker.draggable({
			cursor: 'pointer',
			revert: 'invalid',
			scroll: false,
			zIndex: 999,
			cursorAt: {
				bottom: 0,
				left: -15
			},
			helper: function() {
				var helper = $(document.createElement('div'));
				helper
					.addClass('map-selection-marker')
					.appendTo('body');

				return helper[0];
			},
			start: function(event, ui) {
				_uploadDialog.hide({
					effect: 'slide',
					direction: 'left',
					duration: 200
				});
			},
			stop: function(event, ui) {
				_uploadDialog.show({
					effect: 'slide',
					direction: 'left',
					duration: 200
				});
			}
		});
	}

	function _initSelectionMarkerLayer()
	{
		_selectionMarkerFeature = new ol.Feature({
			geometry: new ol.geom.Point([0, 0])
		});

		_selectionMarkerFeature.setStyle(function() {
			if (this.get('visible'))
			{
				return [new ol.style.Style({
					image: new ol.style.Icon({
						anchor: [0.5, 1],
						anchorXUnits: 'fraction',
						anchorYUnits: 'fraction',
						opacity: 1,
						scale: 0.4,
						src: '/images/Map-Selection-Marker.png'
					})
				})];
			}
			else
			{
				return null;
			}
		});

		// Allow the user to drag around the location selection marker once it has been placed
		_selectionMarkerInteraction = new ol.interaction.Translate({
			features: new ol.Collection([_selectionMarkerFeature])
		});

		BM.map.addInteraction(_selectionMarkerInteraction);
		_selectionMarkerInteraction.setActive(false);

		// Display coordinates to the user as the feature is translated
		_selectionMarkerInteraction.on('translating', function(event) {
			$('body').trigger($.Event('bm:location.pickchange', {
				coordinate: event.coordinate
			}));
		});

		_selectionMarkerLayer = new ol.layer.Vector({
			source: new ol.source.Vector({
				features: [_selectionMarkerFeature]
			})
		});

		// Display on top of other layers
		_selectionMarkerLayer.setZIndex(1000);
		BM.map.addLayer(_selectionMarkerLayer);
	}

	/**
	 * Hides the selection marker, while keeping the feature visible in case the user backtracks to the applicable step
	 * @private
	 */
	function _hideLocationSelectionMarker()
	{
		$('body').trigger($.Event('bm:location.pickend'));
		_selectionMarkerInteraction.setActive(false);
		_selectionMarkerLayer.setVisible(false);
	}

	/**
	 * Upload completed or cancelled, so the selection marker is no longer wanted
	 * @private
	 */
	function _endLocationSelection()
	{
		_hideLocationSelectionMarker();
		_selectionMarkerFeature.set('visible', false);
	}

	function _initMetadataFields()
	{
		$('#media-upload-meta-entry-container').mCustomScrollbar({
			autoHideScrollbar: true,
			scrollInertia: 200,
			mouseWheel: {
				scrollAmount: 100
			},
			theme: 'minimal-dark',
			advanced: {
				updateOnContentResize: true
			}
		});
	}

	function _initUploadProgress()
	{
		_progressFile.find('.progress-bar').progressbar({
			value: 0,
			max: 100
		});

		_progressTotal.find('.progress-bar').progressbar({
			value: 0,
			max: 100
		});

		$('#media-upload-errors').mCustomScrollbar({
			autoHideScrollbar: false,
			scrollInertia: 200,
			mouseWheel: {
				scrollAmount: 100
			},
			scrollButtons: {
				enable: true
			},
			theme: 'inset-dark',
			advanced: {
				updateOnContentResize: true
			}
		});

		var copyButtonElement = $('#media-upload-error-log-copy');
		copyButtonElement.tooltipster({
			content: 'Copied to clipboard',
			theme: ['tooltipster-default', 'battlemap-tooltip-dark'],
			trigger: 'custom',
			autoClose: true,
			timer: 1000
		});

		// Set up the copy button, allowing the user to copy the contents of the error log
		var copyButton = new Clipboard('#media-upload-error-log-copy');
		copyButton.on('success', function(event) {
			copyButtonElement.tooltipster('show');
		});
	}

	function _resetUploadProgressBars()
	{
		_progressFile.find('.progess-bar').progressbar('value', 0);
		_progressTotal.find('.progress-bar').progressbar('value', 0);
	}

	function _setFileUploadProgress(file, percent, bytesSent)
	{
		_progressFile.find('.percentage').text(_formatPercent(percent) + ' %');
		_progressFile.find('.progress-label').text(file.name);
		_progressFile.find('.progress-bar').progressbar('value', percent);
		_progressFile.find('.data-sent').text(_formatDataSent(file.size) + ' sent');
	}

	function _setTotalUploadProgress(percent, totalBytes, totalBytesSent)
	{
		_progressTotal.find('.percentage').text(_formatPercent(percent) + ' %');
		_progressTotal.find('.progress-bar').progressbar('value', percent);
		_progressTotal.find('.data-sent').text(_formatDataSent(totalBytes) + ' remaining');
	}

	function _initMediaReel()
	{
		_mediaReel.mCustomScrollbar({
			autoHideScrollbar: false,
			scrollInertia: 200,
			mouseWheel: {
				scrollAmount: 100
			},
			scrollbarPosition: 'outside',
			theme: 'inset-dark',
			advanced: {
				updateOnContentResize: true
			}
		});
	}

	/**
	 * Enables or disables the automatic requery of images near the map's centre-point, whenever a mapmove is completed
	 * @param {boolean} enable
	 * @private
	 */
	function _enableMediaReelRequery(enable)
	{
		if (enable !== _mediaReelRequeryEnabled)
		{
			var requeryMediaReel = function(event) {
				_requeryMediaReelByPoint(BM.map.getView().getCenter());
			};

			if (enable)
			{
				BM.map.on('moveend', requeryMediaReel);
			}
			else
			{
				BM.map.off('moveend', requeryMediaReel);
				_mediaReelItems = [];
			}
		}
	}

	/**
	 * Requeries the nearest media by a given unprojected OL3 coordinate
	 * @param {ol.Coordinate} point - An unprojected OL3 coordinate
	 * @param [callback]
	 * @private
	 */
	function _requeryMediaReelByPoint(point, callback)
	{
		_requeryMediaReelByLonLat(point, callback);
	}

	/**
	 * Requeries the nearest media by a given lon/lat coordinate
	 * @param {ol.Coordinate} coord - Lon/lat coordinate
	 * @param callback
	 * @private
	 */
	function _requeryMediaReelByLonLat(coord, callback)
	{
		_mediaReelItems = [];

		if (coord && _mediaReelMaxImages > 0)
		{
			if (_currentMediaXHRRequest)
				_currentMediaXHRRequest.abort();

			_currentMediaXHRRequest = $.ajax({
				url: '/api/es/search/avw_incident_media',
				method: 'POST',
				dataType: 'json',
				contentType: 'application/json',
				data: JSON.stringify({
					"size": _mediaReelMaxImages,
					"query": {
						"match": {
							"Approval_Status": 1
						}
					},
					"sort": [{
						"_geo_distance": {
							"Location": {
								"lon": coord[0],
								"lat": coord[1]
							},
							"order": "asc"
						}
					}]
				})
			}).done(function (response) {
				_currentMediaXHRRequest = null;
				_mediaReelItems = response.hits.hits;
				_refreshMediaReel();

				if (callback)
					callback();
			});
		}
	}

	/**
	 * Forces the media reel to update based on the current map view centre point
	 * @private
	 */
	function _requeryMediaReel()
	{
		_requeryMediaReelByPoint(BM.map.getView().getCenter());
	}

	/**
	 * Repopulates the media reel from the items array
	 * @private
	 */
	function _refreshMediaReel()
	{
		var mediaThumbnailList = _mediaReel.find('ul').empty();
		_lightboxItems = [];

		$.each(_mediaReelItems, function (i, item)
		{
			var fields = item._source;
			if (fields.Path && fields.Path !== "")
			{
				var tooltipDescription = fields.Description ? '<p>' + fields.Description + '</p>' : '<em>No description</em>';
				var tooltipLikes = fields.Like_Count > 0 ? '<div class="likes"><span class="fa fa-thumbs-up"></span> ' + fields.Like_Count + ' ' +
					(fields.LikeCount > 1 ? 'likes' : 'like') + '</div>' : '';
				var isImage = _isSupportedImageMimeType(fields.Mime_Type);
				var isVideo = _isSupportedVideoMimeType(fields.Mime_Type);
				var mediaUrl = BM.options.incidentMediaBaseUrl + fields.Path;

				var li = $(document.createElement('li'));
				var thumbnail = $(document.createElement('a'))
					.addClass('thumbnail')
					.prop('rel', 'group')
					.prop('href', mediaUrl)
					.on('click', function(e) {
						e.preventDefault();
					})
					.appendTo(li);

				var tooltipContent = $(
					'<div class="media-info-tooltip">' +
					'<div class="tooltip-heading">' + fields.File_Name + '.' + fields.File_Ext + '</div>' +
					'<div class="tooltip-body">' +
						tooltipDescription + tooltipLikes +
					'</div>' +
					'</div>'
				);

				tooltipContent.find('.image')
					.data('thumbnail', thumbnail)
					.css('background-image', 'url("' + mediaUrl + '")');

				var thumbnailImageUrl = mediaUrl;
				if (isVideo)
					thumbnailImageUrl = '/images/Video-Placeholder.png';

				var thumbnailDiv = $(document.createElement('div'))
					.attr('id', 'media-thumbnail-' + item._id)
					.addClass('media-thumbnail')
					.addClass(isImage ? 'media-thumbnail-image' : 'thumbnail-video')
					.css('background-image', 'url("' + thumbnailImageUrl + '")')
					.appendTo(thumbnail)
					.tooltipster({
						content: tooltipContent,
						side: 'right',
						distance: 0,
						theme: ['tooltipster-default', 'battlemap-tooltip-dark', 'no-padding'],
						delay: 400,
						trackOrigin: true
					})
					.on('mouseover', function ()
					{
						_guidanceLine.setDOMTarget(thumbnail);
						_guidanceLine.setMapTargetCoords(ol.proj.fromLonLat([fields.Location.lon, fields.Location.lat], 'EPSG:3857'));
						_guidanceLine.show();
					})
					.on('mouseout', function ()
					{
						_guidanceLine.hide();
					})
					.on('click', function ()
					{
						_openLightbox(i);
					});

				mediaThumbnailList.append(li);

				if (isVideo)
				{
					var videoID = 'video-' + item._id;
					if (!videojs.getPlayers()[videoID])
					{
						$(document.createElement('div'))
							.attr('id', videoID)
							.addClass('video-container')
							.append($(document.createElement('video'))
								.attr('controls', '')
								.addClass('lg-video-object lg-html5 video-js vjs-default-skin vjs-big-play-centered')
								.text('Your browser does not support HTML 5 video. Please upgrade your browser.')
								.append($(document.createElement('source'))
									.attr('src', mediaUrl)
									.attr('type', fields.Mime_Type)
								)
							)
							.appendTo('body');

						var video = videojs(videoID, {
							preload: 'none'
						}, function () {});
					}

					_lightboxItems.push({
						thumb: '/images/Video-Placeholder.png',
						poster: '',
						html: "#" + videoID,
						mediaInfo: fields
					});
				}
				else
				{
					_lightboxItems.push({
						src: mediaUrl,
						thumb: mediaUrl,
						mediaInfo: fields
					});
				}
			}
		});
	}

	/**
	 * Opens the lightbox
	 * @param {number} [index]
	 * @private
	 */
	function _openLightbox(index)
	{
		index = index || 0;

		// If the LightGallery is already loaded, transition to the selected slide index
		_lightboxSidebar.show({
			effect: 'slide',
			direction: 'right',
			duration: 100
		});

		_mediaReel.lightGallery({
			autoplay: true,
			pause: 10000,
			videojs: true,
			fullScreen: true,
			pager: false,
			zoom: true,
			download: false,
			dynamic: true,
			dynamicEl: _lightboxItems,
			thumbWidth: 80,
			thumbContHeight: 100,
			index: index,
			speed: 300,
			hideBarsDelay: 3000,
			width: _getLightboxWidth(),
			addClass: 'media-lightgallery'
		});

		BM.WindowManager.openMaximised('media.lightgallery');

		_mediaReel
			.on('onAfterOpen.lg', function(event) {
				var closeButton = $(document.createElement('div'))
					.addClass('lg-close-button')
					.click(function() {
						_closeLightbox();
					})
					.append('<span class="icon fa fa-chevron-circle-left"></span>')
					.append('<span class="label">Close</span>');

				$('div.lg-toolbar.lg-group').prepend(closeButton);
			})
			.off('onBeforeSlide.lg')
			.on('onBeforeSlide.lg', function(event, prevIndex, index) {
				_lightboxScope.openMediaItem(_mediaReelItems[index]);
			})
			.off('onBeforeClose.lg')
			.on('onBeforeClose.lg', function() {
				_lightboxSidebar.hide({
					effect: 'slide',
					direction: 'right',
					duration: 100
				});
			})
			.off('onCloseAfter.lg')
			.on('onCloseAfter.lg', function() {
				var lightGallery = _mediaReel.data('lightGallery');
				if (lightGallery)
					lightGallery.destroy(true);

				BM.WindowManager.closeMaximised('media.lightgallery');
			});
	}

	function _closeLightbox()
	{
		$('div.lg-toolbar.lg-group').find('.lg-close').trigger('click');
	}

	/**
	 * Calculates a new width for the lightbox, based on whether it is visible and if so, the width of the sidebar
	 */
	function _getLightboxWidth()
	{
		if (_lightboxSidebar.css('display') !== 'none')
			return $(document).width() - _lightboxSidebar.outerWidth();
		else
			return $(document).width();
	}

	function _formatDataSent(number)
	{
		if (number < 1000)
			return number.toString() + ' bytes';
		else if(number < 1000000)
			return (Math.round(number / 1000)).toString() + ' KB';
		else
			return (number / 1000000).toFixed(1).toString() + ' MB';
	}

	function _formatPercent(percent)
	{
		return Math.round(percent).toString();
	}

	function _isSupportedImageMimeType(mimeType)
	{
		return mimeType ? mimeType.match(/image\/[a-zA-Z0-9\-\/]*/g) : false;
	}

	function _isSupportedVideoMimeType(mimeType)
	{
		return mimeType ? mimeType.match(/video\/[a-zA-Z0-9\-\/]*/g) : false;
	}

	return {
		init: _init,
		enableMediaReelRequery: _enableMediaReelRequery,
		requeryMediaReel: _requeryMediaReel,
		requeryMediaReelByPoint: _requeryMediaReelByPoint,
		requeryMediaReelByLonLat: _requeryMediaReelByLonLat,
		openLightbox: _openLightbox
	};
})();