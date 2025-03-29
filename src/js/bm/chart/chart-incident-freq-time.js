/**
 * Shows incident frequency over time, grouped by date
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.IncidentFrequencyByTime = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.incidentFrequency.types.byTime, controlLabel, chartTitle);
	this.helpTooltipText = 
		'<span>' +
		'This chart displays the number of incidents (Y axis) and the time of day, by hour, at which they occurred (X axis).' +
		'<br><br><strong>Filtering</strong><br>' +
		'You can filter the chart by Units Involved, Operation Name and Incident Type. Doing so allows you to perform ' +
		'more specific analysis. For example, you can view the time of day all mine incidents occurred at.' +
		'<br><br>To apply a filter, select one or more of these fields in the <em>Filters</em> panel and click <em>Apply Filter</em>.' +
		'<br><br><em>Note: When filtering by operation, only the first selected operation is used to filter the chart.</em>' + 
		'</span>';
};

BM.Chart.IncidentFrequencyByTime.prototype = Object.create(BM.Chart.prototype);
BM.Chart.IncidentFrequencyByTime.prototype.constructor = BM.Chart.IncidentFrequencyByTime;

BM.Chart.IncidentFrequencyByTime.prototype.generateChart = function(callback)
{
	var self = this;
	var contactCounts = [];
	var mineCounts = [];

	$.ajax({
		url: '/api/es/search/avw_contacts',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 0,
			"query": BM.FilterPanel.contactFilterController.toElasticSearchQuery(),
			"aggs": {
				"unit_tasks": {
					"terms": {
						"field": "Unit_Task.raw",
						"size": 50,
						"min_doc_count": 20
					},
					"aggs": {
						"hour_of_day": {
							"histogram": {
								"field": "Hour",
								"interval": 1
							}
						}
					}
				}
			}
		})
	}).done(function(data) {
		var series = [];

		$.each(data.aggregations.unit_tasks.buckets, function(i, task) {
			var data = [];
			$.each(task.hour_of_day.buckets, function(i, item) {
				data.push([item.key, item.doc_count]);
			});

			if (data.length > 0)
			{
				series.push({
					name: task.key,
					data: data
				});
			}
		});

		if (self.chartContainer)
		{
			var filterDescription = self.getAppliedFilterDescription();
			var chartOptions = self.mergeChartOptions(BM.ChartOptions.Column, {
				chart: {
					renderTo: self.chartContainer[0]
				},
				title: {
					text: self.chartTitle
				},
				subtitle: {
					text: filterDescription
				},
				xAxis: {
					title: {
						text: 'Hour of the Day Across All Incidents'
					}
				},
				yAxis: {
					minTickInterval: 1,
					title: {
						text: 'Number of Incidents'
					}
				},
				tooltip: {
					headerFormat: '<span style="font-size: 14px">{point.key}:00</span><br/>'
				},
				series: series
			});

			self.chart = new Highcharts.Chart(chartOptions);
			if (callback)
				callback();
		}
	}).fail(function() {
		InfoDialog('Error', 'Chart data could not be retrieved for chart type: ' + self.type);
		if (callback)
			callback();
	});
};