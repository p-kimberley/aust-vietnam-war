BM.TimelineTracker = (function() {
	var _trackerContainer = $('#timeline-tracker-container');
	var _tracker = $('#timeline-tracker');
	var _isActive = false;
	var _isExpanded = false;
	var _interactionDelay = 500;
	var _interactionTimeoutHandle = 0;
	var _trackTypesSelector = $('#timeline-track-types');
	var _selectorContainer = _tracker.find('.selector-container');
	var _navigator = _tracker.find('.navigator');
	var _navigatorDateElement = _navigator.find('.description').find('span');
	var _trackTypes = {
		trackTypeUnit: new BM.TimelineTrackType.Unit(_selectorContainer, _navigatorDateElement)
	};

	/** @type {BM.TimelineTrackType} */
	var _currentTrackType = undefined;

	function _init()
	{
		var delayedInteraction = function(fn) {
			if (_interactionTimeoutHandle)
			{
				clearTimeout(_interactionTimeoutHandle);
				_interactionTimeoutHandle = 0;
			}

			_interactionTimeoutHandle = setTimeout(fn, _interactionDelay);
		};

		// Populate the drop-down list of available tracker types
		$.each(_trackTypes, function(i, item) {
			_trackTypesSelector.append($(document.createElement('option'))
				.text(item.name)
				.prop('selected', 'selected')
				.data('track-type', item)
			);

			_trackTypesSelector.selectmenu({
				width: 100,
				change: function(event, ui) {
					var trackType = ui.item.element.data('track-type');
					if (_currentTrackType)
						_currentTrackType.setActive(false);
					if (trackType)
						trackType.setActive(true);

					_currentTrackType = trackType;
				}
			});
		});

		var controlBox = _tracker.find('.controlbox');
		controlBox.find('.button').tooltipster();
		controlBox.find('.button.minimise').click(function() {
			_setExpanded(false);
		});
		controlBox.find('.button.search').click(function() {
			_setExpanded(true);
		});
		controlBox.find('.button.close').click(function() {
			_setActive(false);
		});

		_tracker.find('.navigator-container').find('.heading').find('span').click(function() {
			_setExpanded(true);
		});

		_tracker.find('.navigator-container').find('.description').find('span').click(function() {
			BM.Timeline.expandTimeline();
			if (_currentTrackType)
				BM.Timeline.isolateSeries(_currentTrackType.timelineSeries);
		});

		_navigator.find('.arrow.left').click(function() {
			_goPrev();
		});
		_navigator.find('.arrow.right').click(function() {
			_goNext();
		});

		_tracker
			.on('mouseleave', function() {
				delayedInteraction(function() {
					//_tracker.removeClass('active');
				});
			})
			.on('mouseenter', function() {
				if (_interactionTimeoutHandle)
				{
					clearTimeout(_interactionTimeoutHandle);
					_interactionTimeoutHandle = 0;
				}
			});

		$('body').on('bm:timeline.expand-changing', function(event) {
			var speed = BM.Timeline.getExpandCollapseSpeed();

			if (event.expanding)
			{
				var expandedHeight = BM.Timeline.getExpandedTimelineHeight();
				_trackerContainer.velocity({bottom: expandedHeight}, speed);
			}
			else
			{
				var collapsedHeight = BM.Timeline.getCollapsedTimelineHeight();
				_trackerContainer.velocity({bottom: collapsedHeight}, speed);
			}
		});
	}

	/**
	 * Shows or hides the tracker UI
	 * @param {boolean} active
	 * @private
	 */
	function _setActive(active)
	{
		if (active)
		{
			_isActive = true;
			_tracker.addClass('active');

			if (_currentTrackType)
				_currentTrackType.setActive(true);

			if (_interactionTimeoutHandle)
			{
				clearTimeout(_interactionTimeoutHandle);
				_interactionTimeoutHandle = 0;
			}
		}
		else
		{
			_isActive = false;
			_tracker.removeClass('active');

			if (_currentTrackType)
				_currentTrackType.setActive(false);
		}
	}

	function _setExpanded(expanded)
	{
		if (expanded)
		{
			_isExpanded = true;
			_tracker.addClass('expanded');

			if (_currentTrackType)
				_currentTrackType.setActive(true);
		}
		else
		{
			_isExpanded = false;
			_tracker.removeClass('expanded');
		}
	}

	/**
	 * @param  {BM.TimelineTrackType} trackType
	 * @private
	 */
	function _setTrackType(trackType)
	{
		_currentTrackType = trackType;
		_currentTrackType.targetChanged();
		_updateSeekButtons();
	}

	/**
	 * Sets the track target and optionally selects an incident
	 * @param targetId
	 * @param {Number} [initialIncidentId]
	 * @private
	 */
	function _setTrackTarget(targetId, initialIncidentId)
	{
		if (_currentTrackType)
		{
			_currentTrackType.setTrackTarget(targetId, initialIncidentId);
			_updateSeekButtons();
		}
	}

	/**
	 * Sets the heading shown in the non-expanded track UI view (i.e. Current tracking <unit name>)
	 * @param {string} heading
	 * @private
	 */
	function _setTrackHeading(heading)
	{
		_tracker.find('.navigator-container').find('.heading').find('span').text(heading);
	}

	function _redraw()
	{
		_trackerContainer.css('bottom', BM.Timeline.getHeight());
	}

	function _goTo(incidentId)
	{
		if (_currentTrackType)
		{
			_currentTrackType.goToByIncidentId(incidentId, true);
			_updateSeekButtons();
		}
	}

	function _goNext()
	{
		if (_currentTrackType)
		{
			_currentTrackType.goNext(true);
			_updateSeekButtons();
		}
	}

	function _goPrev()
	{
		if (_currentTrackType)
		{
			_currentTrackType.goPrev(true);
			_updateSeekButtons();
		}
	}

	function _updateSeekButtons()
	{
		if (_currentTrackType)
		{
			if (_currentTrackType.isAtBeginning())
				_navigator.find('.arrow.left').addClass('disabled');
			else
				_navigator.find('.arrow.left').removeClass('disabled');

			if (_currentTrackType.isAtEnd())
				_navigator.find('.arrow.right').addClass('disabled');
			else
				_navigator.find('.arrow.right').removeClass('disabled');
		}
	}

	return {
		init: _init,
		getTrackTypes: function() { return _trackTypes; },
		setTrackType: _setTrackType,
		setTrackTarget: _setTrackTarget,
		setTrackHeading: _setTrackHeading,
		redraw: _redraw,
		updateSeekButtons: _updateSeekButtons,
		setActive: _setActive,
		setExpanded: _setExpanded,
		goTo: _goTo,
		goNext: _goNext,
		goPrev: _goPrev
	};
})();