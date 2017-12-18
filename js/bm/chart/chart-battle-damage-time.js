/**
 * Shows incident frequency over time, grouped by date
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.BattleDamageByTime = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.battleDamage.types.byTime, controlLabel, chartTitle);
	this.helpTooltipText = 
		'<span>' +
		'This chart shows the numbers (Y axis) of friendly and enemy combat-related casualties against the time of day, by hour, at which ' +
		'they occurred (X axis): Killed in Action (KIA) and Wounded in Action (WIA). You can observe the times at which friendly forces were ' +
		'most successful, by comparing the numbers of friendly and enemy casualties.' +
		'<br><br><strong>Filtering</strong><br>' +
		'You can filter the chart by Units Involved, Operation Name and Incident Type. Doing so allows you to perform ' +
		'more specific analysis. For example, you can compare the different operating patterns of various units and what times of day they suffered ' +
		'the most casualties. ' +
		'<br><br>To apply a filter, select one or more of these fields in the <em>Filters</em> panel and click <em>Apply Filter</em>.' +
		'<br><br><em>Note: When filtering by operation, only the first selected operation is used to filter the chart.</em>' + 
		'</span>';
};

BM.Chart.BattleDamageByTime.prototype = Object.create(BM.Chart.prototype);
BM.Chart.BattleDamageByTime.prototype.constructor = BM.Chart.BattleDamageByTime;

BM.Chart.BattleDamageByTime.prototype.generateChart = function(callback)
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
				"hour_hist": {
					"histogram": {
						"field": "Hour",
						"interval": 1
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

		$.each(data.aggregations.hour_hist.buckets, function(i, item) {
			frKIA.push([item.key, item.fr_kia.value]);
			frWIA.push([item.key, item.fr_wia.value]);
			enKIA.push([item.key, item.en_kia.value]);
			enWIA.push([item.key, item.en_wia.value]);
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
				colors: [
					BM.ChartOptions.colours.enemyKIA,
					BM.ChartOptions.colours.enemyWIA,
					BM.ChartOptions.colours.friendlyKIA,
					BM.ChartOptions.colours.friendlyWIA
				],
				xAxis: {
					title: {
						text: 'Hour of the Day Across All Contacts'
					}
				},
				yAxis: {
					title: {
						text: 'Casualties'
					}
				},
				tooltip: {
					headerFormat: '<span style="font-size: 14px">{point.key}:00</span><br/>'
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