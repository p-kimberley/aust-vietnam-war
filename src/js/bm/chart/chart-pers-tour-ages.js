/**
 * Shows ages of personnel during tours over time
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.PersTourAges = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.personnel.types.ageTours, controlLabel, chartTitle, false);
	this.helpTooltipText =
		'<span>' +
		'This shows the number of tours of duty vs. the various age brackets over time. A single tour of duty typically spanned several months.' +
		'</span>';
};

BM.Chart.PersTourAges.prototype = Object.create(BM.Chart.prototype);
BM.Chart.PersTourAges.prototype.constructor = BM.Chart.PersTourAges;

BM.Chart.PersTourAges.prototype.generateChart = function(callback)
{
	var self = this;

	$.ajax({
		url: '/api/es/search/avw_tours',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 0,
			"aggs": {
				"ages": {
					"range": {
						"field": "Age",
						"ranges": [
							{
								"key": "16-18",
								"from": 16,
								"to": 18
							},
							{
								"key": "19-22",
								"from": 19,
								"to": 22
							},
							{
								"key": "23-26",
								"from": 23,
								"to": 26
							},
							{
								"key": "27-30",
								"from": 27,
								"to": 30
							},
							{
								"key": "31-35",
								"from": 31,
								"to": 35
							},
							{
								"key": "36-40",
								"from": 36,
								"to": 40
							},
							{
								"key": "41-50",
								"from": 41,
								"to": 50
							},
							{
								"key": "Over 50",
								"from": 51
							}
						]
					},
					"aggs": {
						"date_hist": {
							"date_histogram": {
								"field": "Start Date",
								"interval": "month"
							}
						}
					}
				}
			}
		})
	}).done(function(data) {
		var ageBuckets = data.aggregations.ages.buckets;
		var series = [];

		$.each(ageBuckets, function(i, age) {
			var data = [];
			var dates = age.date_hist.buckets;

			$.each(dates, function(j, date) {
				data.push([date.key, date.doc_count]);
			});

			series.push({
				name: age.key,
				data: data
			});
		});

		if (self.chartContainer)
		{
			var chartOptions = self.mergeChartOptions(BM.ChartOptions.AreaDate, {
				chart: {
					type: 'areaspline',
					renderTo: self.chartContainer[0],
					zoomType: 'x'
				},
				title: {
					text: self.chartTitle
				},
				subtitle: {
					text: 'Number of tours by each age bracket over time'
				},
				tooltip: {
					valueDecimals: 0
				},
				xAxis: {
					type: 'datetime',
					title: {
						text: 'Date'
					}
				},
				yAxis: {
					title: {
						text: 'Number of tours'
					}
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