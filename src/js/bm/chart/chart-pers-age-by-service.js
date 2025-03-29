/**
 * Shows average age by service over time
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.PersAgeByService = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.personnel.types.avgAgeByService, controlLabel, chartTitle, false);
	this.helpTooltipText =
		'<span>' +
		'This is a breakdown by service, of the average age of personnel who deployed to Vietnam.' +
		'</span>';
};

BM.Chart.PersAgeByService.prototype = Object.create(BM.Chart.prototype);
BM.Chart.PersAgeByService.prototype.constructor = BM.Chart.PersAgeByService;

BM.Chart.PersAgeByService.prototype.generateChart = function(callback)
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
				"service": {
					"terms": {
						"field": "Service.raw",
						"size": 10
					},
					"aggs": {
						"date_hist": {
							"date_histogram": {
								"field": "Start Date",
								"interval": "month"
							},
							"aggs": {
								"avg_age": {
									"stats": {
										"field": "Age"
									}
								},
								"avg_age_of_death": {
									"stats": {
										"field": "Age at Death"
									}
								}
							}
						}
					}
				}
			}
		})
	}).done(function(data) {
		var serviceBuckets = data.aggregations.service.buckets;
		var series = [];

		$.each(serviceBuckets, function(i, service) {
			var data = [];
			var dates = service.date_hist.buckets;

			$.each(dates, function(j, date) {
				data.push([date.key, date.avg_age.avg]);
			});

			var colour;
			switch(service.key)
			{
				case 'Army':
					colour = '#940000';
					break;
				case 'RAN':
					colour = '#000a75';
					break;
				case 'RAAF':
					colour = '#0fb7ff';
					break;
			}

			series.push({
				name: service.key,
				color: colour,
				data: data
			});
		});

		if (self.chartContainer)
		{
			var chartOptions = self.mergeChartOptions(BM.ChartOptions.Base, {
				chart: {
					type: 'spline',
					renderTo: self.chartContainer[0],
					zoomType: 'x'
				},
				title: {
					text: self.chartTitle
				},
				subtitle: {
					text: 'Average age by service over time'
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
						text: 'Average age (years)'
					}
				},
				plotOptions: {
					spline: {
						connectNulls: true
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