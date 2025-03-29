/**
 * Shows average age by service over time
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.PersAgeOfDeathByService = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.personnel.types.avgAgeOfDeathByService, controlLabel, chartTitle, false);
	this.helpTooltipText =
		'<span>' +
		'The three coloured series show the average age of death of casualties by service (Army, Navy and Air Force). The historical casualty count is shown in grey.' +
		'</span>';
};

BM.Chart.PersAgeOfDeathByService.prototype = Object.create(BM.Chart.prototype);
BM.Chart.PersAgeOfDeathByService.prototype.constructor = BM.Chart.PersAgeOfDeathByService;

BM.Chart.PersAgeOfDeathByService.prototype.generateChart = function(callback)
{
	var self = this;

	$.ajax({
		url: '/api/es/search/avw_nomroll',
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
								"field": "Death.Date",
								"interval": "month"
							},
							"aggs": {
								"avg_age": {
									"avg": {
										"field": "Death.Age_at_Death"
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
		var allSeries = [];
		var seriesDeathCount = {
			color: '#888888',
			name: 'Number of deaths',
			showInLegend: false,
			type: 'areaspline',
			pointPlacement: null,
			data: []
		};

		$.each(serviceBuckets, function(i, service) {
			var serviceData = [];
			var dates = service.date_hist.buckets;

			$.each(dates, function(j, date) {
				serviceData.push([date.key, date.avg_age.value]);

				if (service.key == 'Army')
					seriesDeathCount.data.push([date.key, date.doc_count]);
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

			allSeries.push({
				name: service.key,
				color: colour,
				data: serviceData
			});
		});

		allSeries.push(seriesDeathCount);

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
					text: 'Average age of death by service over time'
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
						text: 'Average age of death (years)'
					}
				},
				plotOptions: {
					spline: {
						connectNulls: true
					}
				},
				series: allSeries
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