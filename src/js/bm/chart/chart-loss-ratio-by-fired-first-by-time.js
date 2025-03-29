/**
 * Shows incident frequency over time, grouped by date
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.LossRatioByFiredFirstByTime = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.lossRatio.types.firedFirstByTime, controlLabel, chartTitle, true);
	this.helpTooltipText = '';
};

BM.Chart.LossRatioByFiredFirstByTime.prototype = Object.create(BM.Chart.prototype);
BM.Chart.LossRatioByFiredFirstByTime.prototype.constructor = BM.Chart.LossRatioByFiredFirstByTime;

BM.Chart.LossRatioByFiredFirstByTime.prototype.generateChart = function(callback)
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
				"date_hist": {
					"histogram": {
						"field": "Hour",
						"interval": 1
					},
					"aggs": {
						"fired_first": {
							"terms": {
								"field": "Fired_First.raw",
								"size": 10,
								"missing": "Unknown"
							},
							"aggs": {
								"avg_loss_ratio": {
									"avg": {
										"script": "doc['Total_Fr_Cas'].value / (doc['Total_En_Cas'].value | 1) / ((doc['Total_Fr_Cas'].value + doc['Total_En_Cas'].value) | 1)"
									}
								}
							}
						}
					}
				}
			}
		})
	}).done(function(data) {
		var frFiredFirst = [];
		var enFiredFirst = [];

		$.each(data.aggregations.date_hist.buckets, function(i, item) {
			$.each(item.fired_first.buckets, function(i, firedFirstItem) {
				if (firedFirstItem.key == 'Friendly')
				{
					frFiredFirst.push({
						x: item.key,
						y: firedFirstItem.avg_loss_ratio.value
					});
				}
				else if(firedFirstItem.key == 'Enemy')
				{
					enFiredFirst.push({
						x: item.key,
						y: firedFirstItem.avg_loss_ratio.value
					});
				}
			});
		});

		if (self.chartContainer)
		{
			var filterDescription = self.getAppliedFilterDescription();
			var chartOptions = self.mergeChartOptions(BM.ChartOptions.Column, {
				chart: {
					renderTo: self.chartContainer[0]
				},
				colors: [
					BM.ChartOptions.colours.friendlyKIA,
					BM.ChartOptions.colours.enemyKIA
				],
				title: {
					text: self.chartTitle
				},
				subtitle: {
					text: filterDescription
				},
				xAxis: {
					floor: 0,
					title: {
						text: 'Hour of day'
					}
				},
				yAxis: {
					min: 0,
					max: 1.1,
					tickInterval: 0.1,
					title: {
						text: 'Ratio of friendly to enemy casualties'
					}
				},
				plotOptions: {
					series: {
						stacking: null
					}
				},
				tooltip: {
					headerFormat: '<span style="font-size: 14px">{point.key}:00</span><br/>',
					valueDecimals: 2
				},
				series: [
					{
						name: 'Friendlies fired first',
						data: frFiredFirst
					},
					{
						name: 'Enemy fired first',
						data: enFiredFirst
					}
				]
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