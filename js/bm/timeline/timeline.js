
BM.Timeline = (function()
{
	var _timelineContainer = $('#map-timeline');
	var _chartContainer = $('#timeline-chart');

	/** @type {Highcharts.stockChart} */
	var _chart = undefined;

	/** @type {[BM.TimelineSeries]} */
	var _series = [];

	// References to the left and right range selector handles, used to display tooltips against each one
	var _leftRangeHandle = _chartContainer.find('g.highcharts-navigator-handle-left');
	var _rightRangeHandle = _chartContainer.find('g.highcharts-navigator-handle-right');

	var _startDatePicker = null;
	var _endDatePicker = null;
	var _expandedTimelineHeight = 300;
	var _collapsedTimelineHeight = 70;                              // Height of the timeline container (#map-timeline) when it is collapsed
	var _expandCollapseSpeed = 200;
	var _isExpanded = true;                                        // Whether the full chart is showing

	/**
	 * Set when a column in the Advanced Timeline is selected
	 * @type {{startDate: moment, endDate: moment}}
	 * @private
	 */
	var _selectedDateRange = undefined;

	var _liveMarkerFilteringEnabled = false;						// If TRUE, markers will be filtered as the user drags the navigator handles
	var _markerFilteringDelay = 1;									// Delay until a filter request is processed (decrease to make more responsive - may impact performance)

	var _playIntervalHandle = 0;                                    // Handle for the setInterval call used by _play(). Enables animation to be paused.
	var _filterTimeoutHandle = 0;									// Enables delays for multiple successive marker filter requests
	var _replaceStateTimeoutHandle = 0;                             // Handle for the setTimeout call used by replaceState(). This resets the timer each time the date interval is changed

	/**
	 * @type {{min: moment, max: moment, dataMin: moment, dataMax: moment}}
	 * @private
	 */
	var _dateRange = {
		min: undefined,                                             // Current date/time span of the timeline. These values are updated as the timeline navigator
		max: undefined,                                             // selector changes
		dataMin: undefined,                                         // Limits of the data set. These are changed when the timeline chart is updated with new data
		dataMax: undefined
	};

	_chart = new Highcharts.StockChart(_chartContainer[0], {
		chart: {
			spacingTop: 8,
			spacingBottom: 2,
			marginTop: 12,
			marginBottom: 10,
			zoomType: 'x',
			backgroundColor: 'transparent',
			style: {
				fontFamily: BM.options.defaultFont
			}
		},
		title: {
			text: 'Combat Incident Frequency',
			y: 19,
			style: {
				fontSize: 15,
				textTransform: 'none'
			}
		},
		credits: {
			enabled: false
		},
		exporting: {
			enabled: false
		},
		rangeSelector: {
			allButtonsEnabled: true,
			inputEnabled: false,
			selected: 3,
			labelStyle: {
				fontFamily: BM.options.defaultFont,
				fontSize: 14
			},
			buttonTheme: {
				r: 2,
				width: 70,
				height: 18,
				stroke: 'rgba(255,255,255,0.3)',
				'stroke-width': 1,
				style: {
					fontSize: 14
				},
				states: {
					hover: {
						stroke: 'rgba(255,255,255,1)',
						'stroke-width': 1
					},
					select: {
						stroke: 'rgba(255,255,255,0.6)',
						'stroke-width': 1
					}
				}
			},
			buttons: [{
				type: 'month',
				count: 1,
				text: '1 month'
			}, {
				type: 'month',
				count: 6,
				text: '6 months'
			}, {
				type: 'year',
				count: 1,
				text: '1 year'
			}, {
				type: 'all',
				text: 'All'
			}]
		},
		navigator: {
			height: 50,
			xAxis: {
				labels: {
					style: {
						color: '#FFF'
					}
				}
			}
		},
		scrollbar: {
			liveRedraw: true
		},
		xAxis: {
			type: 'datetime',
			minTickInterval: 24 * 3600 * 1000,     // Minimum selected period: 1 day
			minRange: 24 * 3600 * 1000,
			title: {
				enabled: false
			},
			labels: {
				style: {
					fontSize: 11,
					fontWeight: 'normal'
				}
			},
			dateTimeLabelFormats: {
				day: '%e %b %y',
				week: '%e %b',
				month: '%b %y',
				year: '%Y'
			},
			events: {
				afterSetExtremes: function(event) {
					_onExtremesChanged(event);
				}
			}
		},
		yAxis: {
			opposite: true,
			min: 1,
			title: {
				text: 'Number of Incidents',
				offset: 20,
				style: {
					fontSize: 14
				}
			},
			labels: {
				enabled: true
			}
		},
		legend: {
			enabled: true,
			align: 'left',
			verticalAlign: 'top',
			backgroundColor: '#333',
			borderColor: '#888',
			borderWidth: 1,
			borderRadius: 3,
			y: 38
		},
		tooltip: {
			shared: false,
			headerFormat: '<span style="font-size: 14px">{point.key}</span><br/>',
			xDateFormat: "%e %b %y",
			style: {
				fontSize: 14
			}
		},
		plotOptions: {
			series: {
				dataGrouping: {
					enabled: true,
					approximation: 'sum',
					dateTimeLabelFormats: {
						day: ['%e %b %Y', '%e %b', '-%e %b %Y'],
						week: ['Week from %e %b %Y', '%e %b', '-%e %b %Y'],
						month: ['%B %Y', '%B', '-%B %Y'],
						year: ['%Y', '%Y', '-%Y']
					},
					groupPixelWidth: 18
				}
			},
			column: {
				allowPointSelect: false,
				point: {
					events: {
						mouseOver: function() {
							var startDate = moment.utc(this.x).startOf('day');
							var endDate = moment.utc(this.x).endOf('day');
							if (this.series.currentDataGrouping)
								endDate.add(this.series.currentDataGrouping.totalRange);

							_notifyDateRangeHover(startDate, endDate);
						},
						mouseOut: function() {
							var startDate = moment.utc(this.x).startOf('day');
							var endDate = moment.utc(this.x).endOf('day');
							if (this.series.currentDataGrouping)
								endDate.add(this.series.currentDataGrouping.totalRange);

							_notifyDateRangeBlur(startDate, endDate);
						},
						click: function() {
							// Manually process click events, to restrict Point selection to single-select only
							if (!this.selected)
							{
								var startDate = moment.utc(this.x).startOf('day');
								var endDate = moment.utc(this.x).endOf('day');
								if (this.series.currentDataGrouping)
									endDate.add(this.series.currentDataGrouping.totalRange);

								_notifyDateRangeDeselected();
								this.select(true, false);
								_notifyDateRangeSelected(startDate, endDate);
							}
						}
					}
				}
			}
		}
	}, function() {
		_chartContainer
			.on('mousedown', function() {
				// De-focus the date pickers if the chart is clicked (Highcharts doesn't do this automatically)
				_startDatePicker.trigger('blur');
				_endDatePicker.trigger('blur');
			})
			.on('mouseleave', function() {
				_notifyDateRangeBlur(_dateRange.min, _dateRange.max);
			});

		_initTimelineDatePickers();
		_chartContainer.trigger('resize');
	});

	/**
	 * Re-generates the chart and re-queries the database (i.e. if a new filter has been applied)
	 * @param [callback]
	 * @private
	 */
	function _init(callback)
	{
		$('body').on('filter.changed', function() {
			_resetDateRange();
		});

		_initTimelineControls();
		_initTimelineDatePickers();
		BM.TimelineTracker.init();

		if (callback)
			callback();
	}

	/**
	 * @param [callback]
	 * @private
	 */
	function _expandTimeline(callback)
	{
		if (!_isExpanded)
		{
			_isExpanded = true;
			_timelineContainer.find('.timeline-button.expand')
				.tooltipster('hide')
				.hide();

			var highchartContainer = _chartContainer.find('.highcharts-container');
			highchartContainer.fadeOut(50, function ()
			{
				_notifyExpandStateChanging();

				$('#timeline-date-selector-container').fadeIn(_expandCollapseSpeed);
				_timelineContainer.velocity({height: _expandedTimelineHeight}, _expandCollapseSpeed);
				_chartContainer.velocity({height: _expandedTimelineHeight}, _expandCollapseSpeed, function ()
				{
					_timelineContainer.find('.timeline-button.collapse').show();
					_chartContainer.find('text.highcharts-title, g.highcharts-range-selector-buttons, #timeline-date-selector-container, g.highcharts-axis, ' +
						'.highcharts-yaxis-labels, .highcharts-yaxis-grid, .highcharts-scrollbar, .highcharts-legend').show();

					_chart.reflow();
					highchartContainer.fadeIn(50, function ()
					{
						_notifyExpandStateChanged();
						if (callback)
							callback();
					});
				});
			});
		}
	}

	/**
	 * @param [callback]
	 * @private
	 */
	function _collapseTimeline(callback)
	{
		if (_isExpanded)
		{
			_isExpanded = false;
			_timelineContainer.find('.timeline-button.collapse')
				.tooltipster('hide')
				.hide();

			// Deselect any highlighted markers
			_notifyDateRangeBlur();
			_notifyDateRangeDeselected();

			var highchartContainer = _chartContainer.find('.highcharts-container');
			$('#timeline-date-selector-container').fadeOut(200);
			highchartContainer.fadeOut(50, function ()
			{
				_notifyExpandStateChanging();

				_timelineContainer.velocity({height: _collapsedTimelineHeight}, _expandCollapseSpeed);
				_chartContainer.velocity({height: _collapsedTimelineHeight}, _expandCollapseSpeed, function ()
				{
					_timelineContainer.find('.timeline-button.expand').show();
					_chartContainer.find('text.highcharts-title, g.highcharts-range-selector-buttons, g.highcharts-axis,' +
						'.highcharts-yaxis-labels, .highcharts-yaxis-grid, .highcharts-scrollbar, .highcharts-legend').hide();

					_chart.reflow();
					highchartContainer.fadeIn(50, function ()
					{
						_notifyExpandStateChanged();
						if (callback)
							callback();
					});
				});
			});
		}
	}

	function _play()
	{
		_timelineContainer.find('.timeline-button.play').hide();
		_timelineContainer.find('.timeline-button.pause').show();

		var intervalToAdd = 24 * 3600 * 1000;
		_playIntervalHandle = setInterval(function() {
			var extremes = _chart.xAxis[0].getExtremes();
			extremes.min += intervalToAdd;
			extremes.max += intervalToAdd;

			// Stop playback if end of bounds have been reached
			if (extremes.max >= _dateRange.dataMax.valueOf())
				_pause();
			else
				_chart.xAxis[0].setExtremes(extremes.min, extremes.max, true, true, { trigger: 'playback' });
		}, 100);
	}

	function _pause()
	{
		_timelineContainer.find('.timeline-button.pause').hide();
		_timelineContainer.find('.timeline-button.play').show();

		clearInterval(_playIntervalHandle);
	}

	/**
	 * Destroys the chart object
	 * @private
	 */
	function _destroy()
	{
		// Destroy the existing chart if it exists
		if (_chart)
		{
			_chart.destroy();
			_chart = undefined;
		}
	}

	/**
	 * Called when Highcharts navigator min/max handle positions are changed
	 * @param event
	 * @private
	 */
	function _onExtremesChanged(event)
	{
		var oldMin = _dateRange.min, oldMax = _dateRange.max;
		var newMin = moment(event.min ? event.min : _dateRange.dataMin).startOf('day').utc();
		var newMax = moment(event.max ? event.max : _dateRange.dataMax).endOf('day').utc();

		_startDatePicker.datepicker('setDate', newMin.toDate());
		_endDatePicker.datepicker('setDate', newMax.toDate());

		_dateRange.min = newMin;
		_dateRange.max = newMax;
		_updateRangeHandleTooltips(newMin, newMax);

		if (event.DOMEvent && !_liveMarkerFilteringEnabled)
		{
			if (event.DOMEvent.buttons && !_liveMarkerFilteringEnabled)
			{
				clearTimeout(_filterTimeoutHandle);
				_filterTimeoutHandle = setTimeout(function() {
					_notifyRangeChange(oldMin, oldMax, newMin, newMax);
				}, _markerFilteringDelay);
			}
			else
			{
				_notifyRangeChange(oldMin, oldMax, newMin, newMax);
			}
		}
		else
		{
			_notifyRangeChange(oldMin, oldMax, newMin, newMax);
		}

		if (_replaceStateTimeoutHandle > 0)
			clearTimeout(_replaceStateTimeoutHandle);

		_replaceStateTimeoutHandle = setTimeout(function() {
			BM.StateManagement.replaceState()
		}, 500);
	}

	/**
	 * Sets data min/max, usually on data change
	 * @private
	 */
	function _updateDataDateRange()
	{
		var dataMin = undefined, dataMax = undefined;

		// Calculate date min/max encompassing all current series
		$.each(_series, function(i, series) {
			var range = series.getDateRange();
			if (range)
			{
				if (dataMin === undefined || range[0] < dataMin)
					dataMin = range[0];
				if (dataMax === undefined || range[1] > dataMax)
					dataMax = range[1];
			}
		});

		// If the date range has changed, update date selection and UI
		if (!dataMin || !dataMin.isSame(_dateRange.dataMin) || !dataMax || !dataMax.isSame(_dateRange.dataMax))
		{
			_dateRange.dataMin = dataMin;
			_dateRange.dataMax = dataMax;

			// Destroy date pickers, to reset their minDate and maxDate options
			_startDatePicker.datepicker('destroy');
			_endDatePicker.datepicker('destroy');

			_initTimelineDatePickers();

			var newMin = _dateRange.min;
			var newMax = _dateRange.max;
			if (_dateRange.min)
			{
				if (_dateRange.min.isValid() && _dateRange.min < _dateRange.dataMin)
					newMin = _dateRange.dataMin;
			}
			if (_dateRange.max)
			{
				if (_dateRange.max.isValid() && _dateRange.max > _dateRange.dataMax)
					newMax = _dateRange.dataMax;
			}

			_setDateRange(newMin, newMax);
		}
	}

	/**
	 * Sets the date range of the timeline
	 * @param {moment} [min]
	 * @param {moment} [max]
	 * @private
	 */
	function _setDateRange(min, max)
	{
		if (min && max)
		{
			var newMin = min.clone(), newMax = max.clone();
			if (!(min instanceof moment) || !(max instanceof moment))
			{
				newMin = moment(min).startOf('day').utc();
				newMax = moment(max).endOf('day').utc();
			}

			_dateRange.min = newMin;
			_dateRange.max = newMax;
		}

		// Set the new timeline boundaries and update the chart
		if (_chart)
			_chart.xAxis[0].setExtremes(_dateRange.min.valueOf(), _dateRange.max.valueOf(), true, false, {trigger: 'datepicker'});
	}

	/**
	 * Enable other UI elements to animate with the Timeline by notifying them prior to expand/collapse animations commencing
	 * @private
	 */
	function _notifyExpandStateChanging()
	{
		$('body').trigger($.Event('bm:timeline.expand-changing', {
			expanding: _isExpanded
		}));
	}

	/**
	 * Timeline has finished expanding/collapsing
	 * @private
	 */
	function _notifyExpandStateChanged()
	{
		$('body').trigger($.Event('bm:timeline.expand-changed', {
			expanded: _isExpanded
		}));
	}

	/**
	 * Notifies listeners that the Timeline date range has changed
	 * @param {moment} oldMin
	 * @param {moment} oldMax
	 * @param {moment} newMin
	 * @param {moment} newMax
	 * @private
	 */
	function _notifyRangeChange(oldMin, oldMax, newMin, newMax)
	{
		$('body').trigger($.Event('bm:timeline.changed', {
			oldMin: oldMin,
			oldMax: oldMax,
			newMin: newMin,
			newMax: newMax
		}));
	}

	/**
	 * User has hovered over a date column, so enable layers to highlight markers applicable to this date range
	 * @param {moment} startDate
	 * @param {moment} endDate
	 * @private
	 */
	function _notifyDateRangeHover(startDate, endDate)
	{
		$('body').trigger($.Event('bm:timeline.daterange-hover', {
			startDate: startDate,
			endDate: endDate
		}));
	}

	/**
	 * User is hovering over a different date
	 * @param {moment} [startDate]
	 * @param {moment} [endDate]
	 * @private
	 */
	function _notifyDateRangeBlur(startDate, endDate)
	{
		$('body').trigger($.Event('bm:timeline.daterange-blur', {
			startDate: startDate,
			endDate: endDate
		}));
	}

	/**
	 * Keeps markers within this date range highlighted. This occurs when a date column is selected.
	 * @param {moment} startDate
	 * @param {moment} endDate
	 * @private
	 */
	function _notifyDateRangeSelected(startDate, endDate)
	{
		_selectedDateRange = {
			startDate: startDate,
			endDate: endDate
		};

		$('body').trigger($.Event('bm:timeline.daterange-selected', {
			startDate: startDate,
			endDate: endDate
		}));
	}

	/**
	 * Cancels the date range selection
	 * @private
	 */
	function _notifyDateRangeDeselected()
	{
		if (_selectedDateRange)
		{
			$('body').trigger($.Event('bm:timeline.daterange-deselected', {
				startDate: _selectedDateRange.startDate,
				endDate: _selectedDateRange.endDate
			}));

			_selectedDateRange = undefined;
		}
	}

	/**
	 * Sets the handles to cover the entire data range
	 * @private
	 */
	function _resetDateRange()
	{
		_setDateRange(_dateRange.dataMin, _dateRange.dataMax);
	}

	/**
	 * Adjusts the chart's dimensions to fill the width of its container, while preserving its expanded/contracted state
	 * @param [callback]
	 * @private
	 */
	function _redraw(callback)
	{
		BM.TimelineTracker.redraw();
		_chartContainer.width(_timelineContainer.width());

		if (_chart)
		{
			_update(function() {
				_chart.reflow();

				// Highcharts chart title re-appears when the chart is resized. Ensure it stays hidden
				if (!_isExpanded)
					_chartContainer.find('text.highcharts-title').hide();

				if (callback)
					callback();
			});
		}
	}

	/**
	 * Updates the timeline using the latest contact data from Layers
	 * @param [callback]
	 * @private
	 */
	function _update(callback)
	{
		_updateRangeHandleTooltips(_dateRange.min, _dateRange.max);
		if (callback)
			callback();
	}

	/**
	 * Returns whether a series exists on the Timeline
	 * @param {BM.TimelineSeries} series
	 * @private
	 */
	function _hasSeries(series)
	{
		return _series.indexOf(series) >= 0;
	}

	/**
	 * Adds a new series to the Timeline. The series can be used by passing the returned object to _removeSeries()
	 * @param {BM.TimelineSeries} series
	 * @returns {Highcharts.series}
	 * @private
	 */
	function _addSeries(series)
	{
		if (_chart)
		{
			var newSeries = _chart.addSeries(series.getOptions());
			_series.push(series);

			// If this is the first series to be added and Timeline is collapsed, hide Highcharts UI elements
			if (_series.length === 1)
				_collapseTimeline();

			return newSeries;
		}
		else
		{
			console.warn('Cannot add Timeline series: _chart is not defined');
		}
	}

	/**
	 * Removes an existing series from the chart
	 * @param {BM.TimelineSeries} series
	 * @private
	 */
	function _removeSeries(series)
	{
		if (series)
		{
			series.remove();

			var newSeries = [];
			$.each(_series, function(i, item) {
				if (item !== series)
					newSeries.push(item)
			});

			_series = newSeries;

			// If only one series remains, show it
			if (_series.length === 1)
				_series[0].setVisible(true);
		}
	}

	/**
	 * Enables the specified series and disables all others using the legend
	 * @param {BM.TimelineSeries} series
	 * @private
	 */
	function _isolateSeries(series)
	{
		if (series)
		{
			$.each(_series, function(i, item) {
				if (item === series)
					item.setVisible(true);
				else
					item.setVisible(false);
			});
		}
	}

	function _initTimelineDatePickers()
	{
		_startDatePicker = $('#timeline-date-start');
		_endDatePicker = $('#timeline-date-end');

		_startDatePicker.datepicker({
			dateFormat: 'dd-mm-yy',
			changeMonth: true,
			changeYear: true,
			minDate: _dateRange.dataMin ? _dateRange.dataMin.toDate() : null,
			maxDate: _dateRange.dataMax ? _dateRange.dataMax.toDate() : null,
			onSelect: function(dateStr) {
				_setDateRange(moment(dateStr, 'DD-MM-YYYY').startOf('day').utc(), _dateRange.max);
			}
		}).on('click', function() {
			_startDatePicker.datepicker('show');
		});

		_endDatePicker.datepicker({
			dateFormat: 'dd-mm-yy',
			changeMonth: true,
			changeYear: true,
			minDate: _dateRange.dataMin ? _dateRange.dataMin.toDate() : null,
			maxDate: _dateRange.dataMax ? _dateRange.dataMax.toDate() : null,
			onSelect: function(dateStr) {
				_setDateRange(_dateRange.min, moment(dateStr, 'DD-MM-YYYY').endOf('day').utc());
			}
		}).on('click', function() {
			_endDatePicker.datepicker('show');
		});
	}

	function _initTimelineControls()
	{
		// Timeline play back and control elements
		var collapseButton = $(document.createElement('div'));
		collapseButton
			.addClass('timeline-button collapse')
			.attr('title', 'Minimise the timeline')
			.append('<span class="fa fa-chevron-down"></span>')
			.tooltipster({
				position: 'left'
			})
			.hide()
			.appendTo(_chartContainer)
			.on('click', function() {
				_collapseTimeline();
			});
		var expandButton = $(document.createElement('div'));
		expandButton
			.addClass('timeline-button expand')
			.attr('title', 'Expand the timeline')
			.append('<span class="fa fa-chevron-up"></span>')
			.tooltipster({
				position: 'left'
			})
			.appendTo(_chartContainer)
			.on('click', function() {
				_expandTimeline();
			});
		var playButton = $(document.createElement('div'));
		playButton
			.addClass('timeline-button play')
			.attr('title', 'Play through all incidents on the map in sequence')
			.append('<span class="fa fa-play-circle"></span>')
			.tooltipster({
				position: 'left'
			})
			.appendTo(_chartContainer)
			.on('click', function() {
				_play();
			});
		var pauseButton = $(document.createElement('div'));
		pauseButton
			.addClass('timeline-button pause')
			.attr('title', 'Pause')
			.append('<span class="fa fa-pause-circle"></span>')
			.tooltipster({
				position: 'left'
			})
			.hide()
			.appendTo(_chartContainer)
			.on('click', function() {
				_pause();
			});
	}

	/**
	 * Sets the content text of the range handle tooltips. Requires tooltipster to be initialised against them already
	 * @param startDate
	 * @param endDate
	 * @private
	 */
	function _updateRangeHandleTooltips(startDate, endDate)
	{
		// Display a tooltip for each of the range selector handles when the user holds the mouse down over them
		if (!_leftRangeHandle.length || !_rightRangeHandle.length)
		{
			_leftRangeHandle = _chartContainer.find('.highcharts-navigator-handle-left');
			_rightRangeHandle = _chartContainer.find('.highcharts-navigator-handle-right');

			_leftRangeHandle.tooltipster({
				side: 'top',
				updateAnimation: false,
				trigger: 'custom',
				autoClose: false
			});
			_rightRangeHandle.tooltipster({
				side: 'top',
				updateAnimation: false,
				trigger: 'custom',
				autoClose: false
			});

			_leftRangeHandle.on('mousedown', function () {
				_leftRangeHandle.tooltipster('show');
			});
			$(window).on('mouseup', function () {
				_leftRangeHandle.tooltipster('hide');
			});
			_rightRangeHandle.on('mousedown', function () {
				_rightRangeHandle.tooltipster('show');
			});
			$(window).on('mouseup', function () {
				_rightRangeHandle.tooltipster('hide');
			});
		}

		if (startDate && endDate && _leftRangeHandle.length && _rightRangeHandle.length && _chart)
		{
			_leftRangeHandle.tooltipster('content', startDate.format('DD/MM/YYYY'));
			_rightRangeHandle.tooltipster('content', endDate.format('DD/MM/YYYY'));
		}
	}

	return {
		Tracker: BM.TimelineTracker,

		init: _init,
		update: _update,
		destroy: _destroy,
		redraw: _redraw,
		hasSeries: _hasSeries,
		addSeries: _addSeries,
		removeSeries: _removeSeries,
		isolateSeries: _isolateSeries,
		updateDataDateRange: _updateDataDateRange,
		setDateRange: _setDateRange,
		resetDateRange: _resetDateRange,
		expandTimeline: _expandTimeline,
		collapseTimeline: _collapseTimeline,
		play: _play,
		pause: _pause,

		getDateRange: function() { return _dateRange; },
		getExtremes: function() { if (_chart) return _chart.xAxis[0].getExtremes(); },
		getExpandCollapseSpeed: function() { return _expandCollapseSpeed; },
		getExpandedTimelineHeight: function() { return _expandedTimelineHeight; },
		getCollapsedTimelineHeight: function() { return _collapsedTimelineHeight; },
		getHeight: function() { return _timelineContainer.height(); },
		isExpanded: function() { return _isExpanded; },

		/**
		 * Creates a string-based representation of the timeline's state, being its current selected date range
		 * @returns {string}
		 */
		serialiseState: function()
		{
			// If the date range selection is different to the maximum allowed range, the user has selected a range using the timeline slider
			if (_dateRange.min !== _dateRange.dataMin || _dateRange.max !== _dateRange.dataMax)
				return _dateRange.min.format('YYYY-MM-DD') + "," + _dateRange.max.format('YYYY-MM-DD');
			else
				return "";
		},

		/**
		 * Restores the timeline based on a serialised browser state
		 * @param serialisedState - Contains two comma-separated date strings in the format yyyy-m-d,yyyy-m-d
		 */
		parseState: function(serialisedState)
		{
			var dates = serialisedState.split(',');
			var min = moment(new Date(dates[0])).startOf('day').utc();
			var max = moment(new Date(dates[1])).endOf('day').utc();

			// If the specified date(s) are invalid, revert to the data min/max
			if (!min.isValid || min < _dateRange.dataMin || min > _dateRange.dataMax)
				min = _dateRange.dataMin;
			if (!max.isValid || max < _dateRange.dataMin || max > _dateRange.dataMax)
				max = _dateRange.dataMax;

			if (min > max)
				min = max.clone();

			this.setDateRange(min, max);
		}
	};
})();

BM.Timeline.featuredBattles = [
	{
		x: Date.UTC(1966, 8, 18),
		title: 'Battle of Long Tan'
	},
	{
		x: Date.UTC(1967, 2, 17),
		title: 'Operation Bribie'
	},
	{
		x: Date.UTC(1967, 8, 6),
		title: 'Battle of Suoi Chau Pha'
	},
	{
		x: Date.UTC(1968, 1, 24),
		title: 'Operation Coburg'
	},
	{
		x: Date.UTC(1968, 5, 12),
		title: 'Battle of Coral Balmoral'
	},
	{
		x: Date.UTC(1968, 12, 3),
		title: 'Battle of Hat Dich'
	},
	{
		x: Date.UTC(1969, 6, 6),
		title: 'Battle of Binh Bah'
	},
	{
		x: Date.UTC(1971, 6, 6),
		title: 'Battle of Long Khanh'
	},
	{
		x: Date.UTC(1971, 9, 21),
		title: 'Battle of Nui Le'
	}
];