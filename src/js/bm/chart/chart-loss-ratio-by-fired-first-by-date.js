/**
 * Shows incident frequency over time, grouped by date
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.LossRatioByFiredFirstByDate = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.lossRatio.types.firedFirstByDate, controlLabel, chartTitle, true);
	this.helpTooltipText = '';
};

BM.Chart.LossRatioByFiredFirstByDate.prototype = Object.create(BM.Chart.prototype);
BM.Chart.LossRatioByFiredFirstByDate.prototype.constructor = BM.Chart.LossRatioByFiredFirstByDate;

BM.Chart.LossRatioByFiredFirstByDate.prototype.generateChart = function(callback)
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
					"date_histogram": {
						"field": "DTG",
						"interval": "day"
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
		var unknownFiredFirst = [];

		$.each(data.aggregations.date_hist.buckets, function(i, item) {
			var fr, en, unknown;
			$.each(item.fired_first.buckets, function(i, firedFirstItem) {
				if (firedFirstItem.key == 'Friendly')
					fr = firedFirstItem.avg_loss_ratio.value;
				else if(firedFirstItem.key == 'Enemy')
					en = firedFirstItem.avg_loss_ratio.value;
				else
					unknown = firedFirstItem.avg_loss_ratio.value;
			});

			if (fr === undefined)
				fr = 0;
			if (en === undefined)
				en = 0;
			if (unknown === undefined)
				unknown = 0;

			frFiredFirst.push([item.key, fr]);
			enFiredFirst.push([item.key, en]);
			unknownFiredFirst.push([item.key, unknown]);
		});

		if (self.chartContainer)
		{
			var filterDescription = self.getAppliedFilterDescription();
			var chartOptions = self.mergeChartOptions(BM.ChartOptions.AreaDate, {
				chart: {
					type: 'spline',
					renderTo: self.chartContainer[0]
				},
				colors: [
					BM.ChartOptions.colours.friendlyKIA,
					BM.ChartOptions.colours.enemyKIA,
					'#555'
				],
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
						afterSetExtremes: function(event)
						{
							if (event.trigger)
								self.synchroniseTimelineWithChartRange(event);
						}
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
						stacking: null,
						dataGrouping: {
							approximation: 'average'
						},
						tooltip: {
							valueDecimals: 2
						}
					}
				},
				series: [
					{
						name: 'Friendlies fired first',
						data: frFiredFirst
					},
					{
						name: 'Enemy fired first',
						data: enFiredFirst
					}/*,
					{
						name: 'Unknown',
						data: unknownFiredFirst
					}*/
				]
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