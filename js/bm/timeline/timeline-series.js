/**
 * @param {{}} options - Options passed to Highcharts
 * @class
 * @constructor
 */
BM.TimelineSeries = function(options)
{
	this.data = [];
	this.options = options;
};

BM.TimelineSeries.prototype.getOptions = function()
{
	return this.options;
};

/**
 * Shows or hides the series in the chart
 * @param {boolean} visible
 */
BM.TimelineSeries.prototype.setVisible = function(visible)
{
	this.options.visible = visible;
	if (this.series)
	{
		if (this.series.visible !== visible && this.series.options)
			this.series.setVisible(visible);
	}
};

BM.TimelineSeries.prototype.add = function()
{
	BM.Timeline.removeSeries(this.series);
	this.series = BM.Timeline.addSeries(this);
};

/**
 * Removes the series from the chart and destroys it
 */
BM.TimelineSeries.prototype.remove = function()
{
	BM.Timeline.removeSeries(this.series);
	this.series = undefined;
};

/**
 * Sets Highcharts series data
 * @param {[]} data
 */
BM.TimelineSeries.prototype.setData = function(data)
{
	if (!this.series)
		throw new Error('Series does not exist, cannot set data');

	this.data = data;
	this.series.setData(data);
	BM.Timeline.updateDataDateRange();
};

/**
 * Returns the date range of the series
 * @returns {[moment, moment]}
 */
BM.TimelineSeries.prototype.getDateRange = function()
{
	if (this.data.length > 1)
		return [moment(this.data[0][0]), moment(this.data[this.data.length - 1][0])];
	else
		return null;
};

/**
 * Selects the latest point with date/time value up to or including the specified date/time value
 * @param {moment} dtg
 */
BM.TimelineSeries.prototype.selectPointByDate = function(dtg)
{
	var dtgValue = dtg.valueOf();

	if (this.series)
	{
		if (this.series.points.length > 0)
		{
			var currentPoint = this.series.points[0];
			$.each(this.series.points, function (i, point) {
				// Point date/time value exceeds that specified, so we've found out required point
				if (moment(point.x) > dtgValue)
					return false;
				else
					currentPoint = point;
			});

			// Select the point in the chart series. This de-selects any currently selected points
			currentPoint.select(true, false);
		}
	}
};