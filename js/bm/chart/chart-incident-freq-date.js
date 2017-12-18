/**
 * Shows incident frequency over time, grouped by date
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.IncidentFrequencyByDate = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.incidentFrequency.types.byDate, controlLabel, chartTitle, true);
	this.helpTooltipText =
		'<span>' +
		'This chart displays the number of incidents (Y axis) over time (X axis). Both contacts and mine incidents are included, ' +
		'depending on the selected filter. ' +
		'By plotting these incidents against time, you can appreciate the operational tempo of 1 ATF throughout the campaign.' +
		'<br><br><strong>Filtering</strong><br>' +
		'You can filter the chart by Units Involved, Operation Name and Incident Type. Doing so allows you to perform ' +
		'more specific analysis. For example, you can view the frequency of all contacts involving 3 RAR.' +
		'<br><br>To apply a filter, select one or more of these fields in the <em>Filters</em> panel and click <em>Apply Filter</em>.' +
		'<br><br><em>Note: When filtering by operation, only the first selected operation is used to filter the chart.</em>' +
		'</span>';
};

BM.Chart.IncidentFrequencyByDate.prototype = Object.create(BM.Chart.prototype);
BM.Chart.IncidentFrequencyByDate.prototype.constructor = BM.Chart.IncidentFrequencyByDate;

BM.Chart.IncidentFrequencyByDate.prototype.generateChart = function(callback)
{
	var self = this;

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
						"date_hist": {
							"date_histogram": {
								"field": "DTG",
								"interval": "day"
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
			$.each(task.date_hist.buckets, function(i, item) {
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
			var chartOptions = self.mergeChartOptions(BM.ChartOptions.AreaDate, {
				chart: {
					type: 'areaspline',
					renderTo: self.chartContainer[0]/*,
					 events: {
					 selection: function(event) {
					 self.synchroniseTimelineWithChartRange(event);
					 }
					 }*/
				},
				title: {
					text: self.chartTitle
				},
				subtitle: {
					text: filterDescription
				},
				xAxis: {
					title: {
						text: 'Date'
					},
					events: {
						afterSetExtremes: function (event)
						{
							if (event.trigger)
								self.synchroniseTimelineWithChartRange(event);
						}
					}
				},
				yAxis: {
					minTickInterval: 1,
					title: {
						text: 'Number of Incidents'
					}
				},
				series: series
			});

			self.chart = new Highcharts.StockChart(chartOptions);

			if (callback)
				callback();
		}
	}).fail(function() {
		InfoDialog('Error', 'Chart data could not be retrieved for chart type: ' + self.type);
		if (callback)
			callback();
	});
};