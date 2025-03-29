/**
 * Identifies a ChartGroup by its groupName or Chart by its type. This allows the chart state to be serialised
 */
BM.ChartType = {
	incidentFrequency: {
		groupName: 'incidfreq',
		types: {
			byDate: 'incidfreq-date',
			byTime: 'incidfreq-time'
		}
	},
	battleDamage: {
		groupName: 'battledmg',
		types: {
			byDate: 'battledmg-date',
			byTime: 'battledmg-time'
		}
	},
	combatEfficiency: {
		groupName: 'combateff',
		types: {
			byDate: 'combateff-date',
			byTime: 'combateff-time'
		}
	},
	lossRatio: {
		groupName: 'lossratio',
		types: {
			firedFirstByDate: 'lossratio-fired-first-by-date',
			firedFirstByTime: 'lossratio-fired-first-by-time'
		}
	},
	casualtyCauses: {
		groupName: 'cascauses',
		types: {
			composite: 'cascauses-composite',
			sideBySide: 'cascauses-sxs'
		}
	},
	weapon: {
		groupName: 'weapon',
		types: {
			rndsFiredByRange: 'weapon-rds-fired-ranges',
			casByRange: 'weapon-cas-fired-ranges',
			rndsFiredByUnitTask: 'weapon-rds-fired-unit-task',
			rndsFiredByUnitTaskOverTime: 'weapon-rds-fired-unit-task-time',
			rndsFiredPerCasByUnitTask: 'weapon-rnds-fired-per-cas-by-unit-task'
		}
	},
	personnel: {
		groupName: 'personnel',
		types: {
			ageTours: 'pers-age-tours',
			avgAgeByService: 'pers-age-svc',
			avgAgeOfDeathByService: 'pers-age-death-svc'
		}
	}
};

/**
 * Contains a highcharts object and manages its creation and selection
 * @param {BM.ChartType} type
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @param {bool} [syncWithTimeline] - Whether to keep the chart in sync with the Timeline
 * @class
 * @constructor
 */
BM.Chart = function(type, controlLabel, chartTitle, syncWithTimeline)
{
	var self = this;

	/** @type {BM.ChartGroup} */
	this.parentGroup = null;
	this.controlLabel = controlLabel;                       // Selector control label text
	this.chartTitle = chartTitle;                           // Title displayed in the chart area
	this.type = type;                                       // Type of chart, used to identify it and and serialise the chart state
	this.chartContainer = null;								// Chart render target
	this.chart = null;                                      // Chart object
	this.isDirty = false;                                   // Whether the chart should be updated when next selected (caused by a filter change)
	this.syncWithTimeline = syncWithTimeline;				// Whether to keep the timeline's selected date range in sync with the Timeline
	this.helpTooltipText = "";                              // Help message shown when hovering over the (?) icon

	var chartControlID = 'chart-' + this.type;
	this.selectorControlContainer = $(document.createElement('div'));
	this.selectorControl = $(document.createElement('input'))
		.addClass('chart-selector-control')
		.attr('type', 'radio')
		.attr('value', type)
		.attr('id', chartControlID)
		.appendTo(this.selectorControlContainer);
	$(document.createElement('label'))
		.addClass('chart-selector-control')
		.attr('for', chartControlID)
		.text(this.controlLabel)
		.appendTo(this.selectorControlContainer);

	$('body').on('bm:timeline.changed', function(event) {
		self.synchroniseChartRangeWithTimeline(event);
	});
};

/**
 * Acts on the chart being enabled/disabled. Initiates chart generation when a chart is selected
 */
BM.Chart.prototype.stateChanged = function()
{
	var self = this;
	if (this.isChecked())
	{
		this.parentGroup.chartController.openChartContainer(function() {
			self.show();
		});
	}
	else
	{
		this.hide();
	}
};

BM.Chart.prototype.check = function()
{
	this.selectorControl.iCheck('check');
};

BM.Chart.prototype.uncheck = function()
{
	this.selectorControl.iCheck('uncheck');
};

BM.Chart.prototype.isChecked = function()
{
	return this.selectorControl.prop('checked') === true;
};

/**
 * Shows the chart
 */
BM.Chart.prototype.show = function()
{
	var self = this;

	var showChart = function() {
		self.chartContainer.show();

		if (self.syncWithTimeline)
			self.synchroniseChartRangeWithTimeline();
	};

	if (this.isDirty || !this.chartContainer)
	{
		this.update(function() {
			showChart();
			self.reflow();
		});
	}
	else
	{
		showChart();
		self.reflow();
	}
};

/**
 * Hides the chart from view, to enable another chart to be shown
 */
BM.Chart.prototype.hide = function()
{
	if (this.chartContainer)
		this.chartContainer.hide();
};

/**
 * Method to update the chart when source data changes (i.e. a filter is applied). Can be overridden.
 * @param [callback]
 */
BM.Chart.prototype.update = function(callback)
{
	var self = this;
	var chartContainer = this.parentGroup.chartController.chartContainer;
	if (!chartContainer)
	{
		console.log('Warning: Chart container not initialised. Cannot generate chart');
		return;
	}

	// Generate the chart DIV if this is the first update() call
	if (!this.chartContainer)
	{
		// The actual DIV that is used to create the chart
		this.chartContainer = $(document.createElement('div'))
			.attr('id', 'chart-' + this.type)
			.css('height', '100%')
			.appendTo(chartContainer);
	}

	this.isDirty = false;
	DisplayLoadingIndicator(self.chartContainer, 'Loading chart');
	self.generateChart(function() {
		HideLoadingIndicator(self.chartContainer);
		self.reflow();
		BM.ActivityLogging.logEvent(BM.LogEventTypes.openedChart, null, self.type);
		if (callback)
			callback();
	});
};

/**
 * Performs a deep copy of the default options array then overrides options specific to this chart
 * @param {{}} optionsBase - Base options to copy (i.e. BM.ChartOptions.Base)
 * @param {{}} options - Options associative array to merge with the base options
 * @returns {{}}
 */
BM.Chart.prototype.mergeChartOptions = function(optionsBase, options)
{
	var mergedOptions = {};
	$.extend(true, mergedOptions, optionsBase, options);
	return mergedOptions;
};

/**
 * Interface method to generate the chart
 * @param [callback]
 * @abstract
 * @private
 */
BM.Chart.prototype.generateChart = function(callback) {};

/**
 * Sets the chart's selected date region to the Timeline selection
 * @param [event]
 */
BM.Chart.prototype.synchroniseChartRangeWithTimeline = function(event)
{
	if (this.chart && this.syncWithTimeline)
	{
		var chartExtremes = this.chart.xAxis[0];
		var timelineExtremes;
		var timelineMin, timelineMax;
		var min, max;

		if (!event)
		{
			timelineExtremes = BM.Timeline.getExtremes();
			timelineMin = timelineExtremes.min.valueOf();
			timelineMax = timelineExtremes.max.valueOf();
		}
		else
		{
			timelineMin = event.newMin.valueOf();
			timelineMax = event.newMax.valueOf();
		}

		if (chartExtremes.dataMin && chartExtremes.dataMin > timelineMin)
			min = chartExtremes.dataMin;
		else
			min = timelineMin;
		if (chartExtremes.dataMax && chartExtremes.dataMax < timelineMax)
			max = chartExtremes.dataMax;
		else
			max = timelineMax;

		this.chart.xAxis[0].setExtremes(min, max, true, false);
	}
};

/**
 * Synchronises the Timeline with the chart's selected date region
 * @param event - Event object containing the axis date range selection
 */
BM.Chart.prototype.synchroniseTimelineWithChartRange = function(event)
{
	if (this.chart && this.syncWithTimeline && event)
		BM.Timeline.setDateRange(moment.utc(event.min), moment.utc(event.max));
};

/**
 * Returns a message containing the current list of applied chart filters
 * @returns {string}
 */
BM.Chart.prototype.getAppliedFilterDescription = function()
{
	var filterController = BM.FilterPanel.contactFilterController;
	var enabledFilters = filterController.getEnabledFilters();
	var filterList = "";

	$.each(enabledFilters, function(i, filter) {
		if (filterList.length > 0)
			filterList += ', ';

		filterList += filter.label;
	});

	if (filterList.length > 0)
		return "Filtered by: " + filterList;
	else
		return "Results are not filtered";
};

/**
 * Hides and destroys the chart
 * @param [callback]
 */
BM.Chart.prototype.destroy = function(callback)
{
	var self = this;
	if (this.chartContainer)
	{
		self.chartContainer.fadeOut(500, function() {
			self.chart.destroy();
			self.chart = null;

			if (callback)
				callback();
		});
	}
	else
	{
		if (callback)
			callback();
	}
};

/**
 * Updates the chart's dimensions when the container is resized
 */
BM.Chart.prototype.resize = function()
{
	if (this.chart)
		this.chart.resize();
};

/**
 * Adjusts the chart to fit in its container
 */
BM.Chart.prototype.reflow = function()
{
	if (this.chart)
		this.chart.reflow()
};

/**
 * Acts as a selectable heading for chart controls, grouping related charts together
 * @param {BM.ChartType} type
 * @param {string} controlLabel - Label to display against the group selector control
 * @constructor
 */
BM.ChartGroup = function(type, controlLabel)
{
	/** @type {BM.ChartController} */
	this.chartController = null;
	this.charts = [];                                           // Array of charts contained by the group
	this.selectedChart = null;                                  // The currently selected chart
	this.type = type;
	this.controlLabel = controlLabel;
	var selectorControlID = 'chart-group-' + this.type;
	this.selectorControlContainer = $(document.createElement('div'))
		.addClass('chart-selector-container');
	this.selectorControl = $(document.createElement('input'))
		.addClass('chart-selector-control')
		.attr('type', 'checkbox')
		.attr('id', selectorControlID)
		.appendTo(this.selectorControlContainer);
	$(document.createElement('label'))
		.addClass('chart-selector-control')
		.attr('for', selectorControlID)
		.text(this.controlLabel)
		.appendTo(this.selectorControlContainer);

	// Create an element to contain all individual chart selector controls
	this.chartControlContainer = $(document.createElement('div'))
		.addClass('chart-control-container')
		.appendTo(this.selectorControlContainer);
};

/**
 * Adds an initialised chart to the group
 * @param {BM.Chart} newChart
 * @returns {BM.ChartGroup}
 */
BM.ChartGroup.prototype.addChart = function(newChart)
{
	var self = this;
	this.chartControlContainer.append(newChart.selectorControlContainer);
	BM.initICheckUIControl(newChart.selectorControl);
	newChart.parentGroup = this;
	newChart.selectorControl.attr('name', this.type);
	newChart.selectorControl.on('ifToggled', function() {
		self.selectedChart = newChart;
		self.chartStateChanged(newChart);
		newChart.stateChanged();
		BM.StateManagement.replaceState();
	});

	this.charts.push(newChart);
	return this;
};

/**
 * Expands the group, revealing its chart controls. Checks the first control if none are checked
 */
BM.ChartGroup.prototype.stateChanged = function()
{
	var self = this;
	if (this.isChecked())
	{
		// Only show the chart selectors if the group contains more than one chart
		if (this.charts.length > 1)
			this.chartControlContainer.show(200);

		this.chartController.openChartContainer(function() {
			// Show the chart if it was hidden due to the group being deselected
			if (self.selectedChart)
			{
				self.selectedChart.show();
			}
			else
			{
				// If there is no chart selected, choose the first one
				if (self.charts.length > 0)
					self.charts[0].check();
			}
		});
	}
	else
	{
		this.chartControlContainer.hide(200);
		this.selectedChart.hide();
	}
};

/**
 *
 * @param {BM.Chart} chart
 */
BM.ChartGroup.prototype.chartStateChanged = function(chart)
{
	if (chart.isChecked())
	{
		$('#chart-controlbox-help-tooltip').tooltipster('content', $(chart.helpTooltipText));

		// Ensures that if the chart is selected via code, its parent group is also checked
		if (!chart.parentGroup.isChecked() && chart.parentGroup !== this.chartController.selectedGroup)
			chart.parentGroup.check();
	}
};

/**
 * Checks the group control
 * @param {boolean} [suppressEventBubble] - Whether to prevent the ChartController from acting on the group's state change
 * @param [callback]
 */
BM.ChartGroup.prototype.check = function(suppressEventBubble, callback)
{
	if (!suppressEventBubble)
	{
		this.selectorControl.iCheck('check', function() {
			if (callback)
				callback();
		});
	}
	else
	{
		// Uncheck the selector without triggering the ChartController's event handler
		this.selectorControl
			.prop('checked', true)
			.iCheck('update');

		this.chartControlContainer.show(200, function() {
			if (callback)
				callback();
		});
	}
};

/**
 * Unchecks the group control
 * @param {boolean} [suppressEventBubble=false] - Whether to prevent the ChartController from acting on the group's state change
 * @param [callback]
 */
BM.ChartGroup.prototype.uncheck = function(suppressEventBubble, callback)
{
	if (!suppressEventBubble)
	{
		this.selectorControl.iCheck('uncheck', function() {
			if (callback)
				callback();
		});
	}
	else
	{
		// Uncheck the selector without triggering the ChartController's event handler
		this.selectorControl
			.prop('checked', false)
			.iCheck('update');

		this.chartControlContainer.hide(200, function() {
			if (callback)
				callback();
		});
	}
};

BM.ChartGroup.prototype.isChecked = function()
{
	return this.selectorControl.first().prop('checked') === true;
};

/**
 * Returns the selected chart within this group
 * @returns {BM.Chart,*}
 */
BM.ChartGroup.prototype.getSelectedChart = function()
{
	return this.selectedChart;
};

/**
 * Enables user interaction with charts and manages their creation
 * @param controlContainer - jQuery object containing the chart selector controls
 * @param chartContainer - Container for the chart, when displayed
 * @constructor
 */
BM.ChartController = function(controlContainer, chartContainer)
{
	var self = this;
	this.controlContainer = controlContainer;
	this.chartContainer = chartContainer;                           // Element containing the controlbox, chart and any other UI elements for chart manipulation
	this.isChartContainerOpen = false;
	this.groups = [];                                               // Array of chart groups
	this.selectedGroup = null;                                      // Currently selected group

	if (!this.controlContainer || !this.chartContainer)
		console.log('Error: An invalid container element was provided to ChartController');

	$('#chart-controlbox-help-tooltip').tooltipster({
		side: 'bottom',
		maxWidth: 400
	});

	$('#chart-controlbox-button-close')
		.tooltipster({
			side: 'bottom'
		})
		.on('click', function() {
			$(this).tooltipster('hide');
			self.closeChartContainer();
		});

	$('body').on('bm:contact-filter.changed', function() {
		self.filtersUpdated();
	});
};

/**
 * Adds an initialised ChartGroup to the controller
 * @param {BM.ChartGroup} newGroup
 * @returns {BM.ChartGroup}
 */
BM.ChartController.prototype.addGroup = function(newGroup)
{
	var self = this;
	this.groups.push(newGroup);
	this.controlContainer.append(newGroup.selectorControlContainer);
	BM.initICheckUIControl(newGroup.selectorControl);
	newGroup.chartController = this;
	newGroup.selectorControl.on('ifToggled', function() {
		self.groupStateChanged(newGroup, function() {
			BM.StateManagement.replaceState();
			newGroup.stateChanged();
		});
	});

	return newGroup;
};

/**
 * Responds to a group being checked/unchecked and ensures that only one group is selected at a time
 * @param {BM.ChartGroup} group
 * @param [callback]
 * @private
 */
BM.ChartController.prototype.groupStateChanged = function(group, callback)
{
	var self = this;

	// The group has moved from an unchecked to a checked state, so hide the current chart if it exists without closing the chart container
	if (group.isChecked())
	{
		if (this.selectedGroup && this.selectedGroup !== group)
		{
			if (this.selectedGroup.selectedChart)
				this.selectedGroup.selectedChart.hide();

			this.selectedGroup.uncheck(true, function() {
				self.selectedGroup = group;
				if (callback)
					return callback();
			});
		}
		else
		{
			self.selectedGroup = group;
		}
	}
	else
	{
		// No group is selected, so close the chart container
		this.selectedGroup = null;
		this.closeChartContainer();
	}

	if (callback)
		callback();
};

/**
 * Returns a ChartGroup via its group type
 * @param {BM.ChartType} groupID
 * @returns {BM.ChartGroup}
 */
BM.ChartController.prototype.getGroup = function(groupID)
{
	for(var i = 0; i < this.groups.length; i++)
	{
		var group = this.groups[i];
		if (group.type === groupID)
			return group;
	}

	console.log('Warning: ChartController.getGroup could not find the chart group "' + groupID + '"');
	return null;
};

/**
 * Retrieves a BM.Layer by its LayerType
 * @param {BM.ChartType,*} chartType
 * @returns {BM.Chart}
 */
BM.ChartController.prototype.getChart = function(chartType)
{
	for(var i = 0; i < this.groups.length; i++)
	{
		var group = this.groups[i];
		for(var j = 0; j < group.charts.length; j++)
		{
			var chart = group.charts[j];
			if (chart.type === chartType)
				return chart;
		}
	}

	console.log('Warning: ChartController.getChart could not find the chart "' + chartType + '"');
	return null;
};

/**
 * Retrieves the currently selected chart
 * @returns {BM.Chart}
 */
BM.ChartController.prototype.getSelectedChart = function()
{
	if (this.selectedGroup)
	{
		if (this.selectedGroup.selectedChart)
			return this.selectedGroup.selectedChart;
	}

	return null;
};

/**
 * Retrieves the currently selected chart group
 * @returns {BM.ChartGroup}
 */
BM.ChartController.prototype.getSelectedGroup = function()
{
	return this.selectedGroup;
};

/**
 * Selects a chart by its ID, checking its control and displaying it
 * @param {BM.ChartType} chartType
 */
BM.ChartController.prototype.selectChart = function(chartType)
{
	var chart = this.getChart(chartType);
	if (chart)
		chart.check();
};

/**
 * Selects a group by its ID, checking its control and displaying its current chart
 * @param {BM.ChartType} groupID
 */
BM.ChartController.prototype.selectGroup = function(groupID)
{
	var group = this.getGroup(groupID);
	if (group)
		group.check();
};

/**
 * Regenerates the currently selected chart
 * @param [callback]
 */
BM.ChartController.prototype.updateSelectedChart = function(callback)
{
	var selectedChart = this.getSelectedChart();
	if (selectedChart)
	{
		selectedChart.update(function () {
			if (callback)
				callback();
		});
	}
	else
	{
		if (callback)
			callback();
	}
};

/**
 * Resizes the selected chart when its container size has changed
 */
BM.ChartController.prototype.reflowSelectedChart = function()
{
	var selectedChart = this.getSelectedChart();
	if (selectedChart)
		selectedChart.reflow();
};

/**
 * Sets the selected date extremes of the current chart to the Timeline's selected range
 * @param {Event} [event]
 */
BM.ChartController.prototype.synchroniseSelectedChartExtremes = function(event)
{
	var selectedChart = this.getSelectedChart();
	if (selectedChart)
		selectedChart.synchroniseChartRangeWithTimeline(event);
};

/**
 * If the filter selection has changed, force all charts to be updated when next opened. The currently selected chart is updated by this method.
 * @param [callback]
 * @private
 */
BM.ChartController.prototype.filtersUpdated = function(callback)
{
	var self = this;
	for(var i = 0; i < this.groups.length; i++)
	{
		var group = this.groups[i];
		for(var j = 0; j < group.charts.length; j++)
		{
			group.charts[j].isDirty = true;
		}
	}

	this.updateSelectedChart(function() {
		self.synchroniseSelectedChartExtremes();
		if (callback)
			callback();
	});
};

/**
 * Displays the chart container
 * @param [callback]
 */
BM.ChartController.prototype.openChartContainer = function(callback)
{
	var self = this;
	if (!this.isChartContainerOpen)
	{
		BM.WindowManager.openMaximised('chart');
		this.chartContainer.fadeIn(200, function () {
			self.isChartContainerOpen = true;
			if (callback)
				callback();
		});
	}
	else
	{
		if (callback)
			callback();
	}
};

/**
 * Closes the chart container
 * @param [callback]
 */
BM.ChartController.prototype.closeChartContainer = function(callback)
{
	var self = this;

	var closeContainer = function()	{
		BM.WindowManager.closeMaximised('chart');
		self.chartContainer.fadeOut(400, function () {
			self.isChartContainerOpen = false;

			// Contacts may be out-of-sync with the Timeline due to the chart being open. Re-sync now.
			BM.Timeline.setDateRange();

			if (callback)
				callback();
		});
	};

	if (this.isChartContainerOpen)
	{
		// No chart group is open, so the container can now be closed
		if (!this.selectedGroup)
		{
			closeContainer();
		}
		else
		{
			// This method was invoked directly (i.e. the close button), so close the open chart group first
			self.selectedGroup.uncheck(false, closeContainer);
		}
	}
	else
	{
		if (callback)
			callback();
	}
};

/**
 * Serialises the state of the ChartController to enable future restoration.
 * Returns a string containing the ChartType of the currently selected chart
 * @returns {string}
 */
BM.ChartController.prototype.serialiseState = function()
{
	if (this.selectedGroup)
	{
		if (this.selectedGroup.selectedChart)
			return this.selectedGroup.selectedChart.type;
	}

	return "";
};

/**
 * Opens a chart from its serialised ChartType
 * @param {string} serialisedState
 */
BM.ChartController.prototype.parseState = function(serialisedState)
{
	var chart = this.getChart(serialisedState);
	if (chart)
		chart.check();
};