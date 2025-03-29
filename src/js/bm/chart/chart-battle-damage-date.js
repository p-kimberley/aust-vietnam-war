/**
 * Shows incident frequency over time, grouped by date
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.BattleDamageByDate = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.battleDamage.types.byDate, controlLabel, chartTitle, true);
	this.helpTooltipText =
		'<span>' +
		'This chart shows the numbers (Y axis) of friendly and enemy combat-related casualties versus time (X axis): ' +
		'Killed in Action (KIA) and Wounded in Action (WIA). ' +
		'<br><br><strong>Filtering</strong><br>' +
		'You can filter the chart by Units Involved, Operation Name and Incident Type. Doing so allows you to perform ' +
		'more specific analysis. For example, you can analyse the number of enemy casualties inflicted by SAS patrols and compare ' +
		'these to 3 RAR. This can provide insight into how the different tactics employed influenced the cost of battle. ' +
		'<br><br>To apply a filter, select one or more of these fields in the <em>Filters</em> panel and click <em>Apply Filter</em>.' +
		'<br><br><em>Note: When filtering by operation, only the first selected operation is used to filter the chart.</em>' + 
		'</span>';
};

BM.Chart.BattleDamageByDate.prototype = Object.create(BM.Chart.prototype);
BM.Chart.BattleDamageByDate.prototype.constructor = BM.Chart.BattleDamageByDate;

BM.Chart.BattleDamageByDate.prototype.generateChart = function(callback)
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
						"en_kia": {
							"sum": {
								"field": "En_KIA"
							}
						},
						"en_wia": {
							"sum": {
								"field": "En_WIA"
							}
						},
						"fr_kia": {
							"sum": {
								"field": "Fr_KIA"
							}
						},
						"fr_wia": {
							"sum": {
								"field": "Fr_WIA"
							}
						}
					}
				}
			}
		})
	}).done(function(data) {
		var frKIA = [];
		var frWIA = [];
		var enKIA = [];
		var enWIA = [];

		$.each(data.aggregations.date_hist.buckets, function(i, item) {
			frKIA.push([item.key, item.fr_kia.value]);
			frWIA.push([item.key, item.fr_wia.value]);
			enKIA.push([item.key, item.en_kia.value]);
			enWIA.push([item.key, item.en_wia.value]);
		});

		if (self.chartContainer)
		{
			var filterDescription = self.getAppliedFilterDescription();
			var chartOptions = self.mergeChartOptions(BM.ChartOptions.AreaDate, {
				chart: {
					type: 'areaspline',
					renderTo: self.chartContainer[0]
				},
				colors: [
					BM.ChartOptions.colours.enemyKIA,
					BM.ChartOptions.colours.enemyWIA,
					BM.ChartOptions.colours.friendlyKIA,
					BM.ChartOptions.colours.friendlyWIA
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
					title: {
						text: 'Casualties'
					}
				},
				series: [
					{
						name: 'Enemy KIA',
						data: enKIA
					},
					{
						name: 'Enemy WIA',
						data: enWIA
					},
					{
						name: 'Friendly KIA',
						data: frKIA
					},
					{
						name: 'Friendly WIA',
						data: frWIA
					}
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