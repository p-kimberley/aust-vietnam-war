/**
 * Shows incident frequency over time, grouped by date
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.WeaponUseByUnitTask = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.weapon.types.rndsFiredByUnitTask, controlLabel, chartTitle);
	this.helpTooltipText =
		'<span>' +
		'This chart displays the number of rounds fired by each weapon type, by unit task.' +
		'</span>';
};

BM.Chart.WeaponUseByUnitTask.prototype = Object.create(BM.Chart.prototype);
BM.Chart.WeaponUseByUnitTask.prototype.constructor = BM.Chart.WeaponUseByUnitTask;

BM.Chart.WeaponUseByUnitTask.prototype.generateChart = function(callback)
{
	var self = this;

	$.ajax({
		url: '/api/es/search/avw_contacts/contact',
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
						"size": 20
					},
					"aggs": {
						"weapon_effects": {
							"children": {
								"type": "weapon_effect"
							},
							"aggs": {
								"friendly_weapons": {
									"filter": {
										"term": {
											"Actor.raw": "Friendly"
										}
									},
									"aggs": {
										"weapons": {
											"terms": {
												"field": "Weapon.Name.raw",
												"size": 50
											},
											"aggs": {
												"avg_rds_fired": {
													"sum": {
														"field": "Rounds_Fired"
													}
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		})
	}).done(function(data) {
		var unitTasks = data.aggregations.unit_tasks.buckets;
		var categoryNames = [];
		var categories = [];
		var weapons = {};
		var series = [];

		$.each(unitTasks, function(i, unitTask) {
			categoryNames.push(unitTask.key);
			categories.push({
				name: unitTask.key,
				index: i
			});

			$.each(unitTask.weapon_effects.friendly_weapons.weapons.buckets, function(j, weapon) {
				if (!weapons[weapon.key])
					weapons[weapon.key] = [];

				// Store rounds fired stat against weapon and category index
				weapons[weapon.key][i] = {
					rdsFired: weapon.avg_rds_fired.value,
					contacts: weapon.doc_count
				};
			});
		});

		// Generate each series, ensuring that data is ordered by category
		for(var key in weapons)
		{
			var weapon = weapons[key];
			var weaponStats = [];
			for(var i = 0; i < categories.length; i++)
			{
				var weaponCategoryStats = weapon[categories[i].index];
				if (weaponCategoryStats)
				{
					weaponStats.push({
						name: categories[i].name,
						y: weaponCategoryStats.rdsFired,
						contactCount: weaponCategoryStats.contacts
					});
				}
			}

			var weaponTotalRdsFired = weaponStats.reduce(function(a, b) {
				return {y: a.y + b.y};
			}).y;

			var newSeries = {
				name: key,
				data: weaponStats
			};

			// Insert the series into the array, ordered by the number of rounds fired
			for(i = 0; i < series.length; i++)
			{
				var totalRdsFired = series[i].data.reduce(function(a, b) {
					return {y: a.y + b.y};
				}).y;

				if (weaponTotalRdsFired < totalRdsFired)
				{
					series.splice(i, 0, newSeries);
					break;
				}
			}

			if (i === series.length)
				series.push(newSeries);
		}

		if (self.chartContainer)
		{
			var chartOptions = self.mergeChartOptions(BM.ChartOptions.Base, {
				chart: {
					type: 'bar',
					renderTo: self.chartContainer[0]
				},
				title: {
					text: self.chartTitle
				},
				xAxis: {
					title: 'Unit Task',
					type: 'category',
					min: 0,
					tickmarkPlacement: 'on',
					labels: {
						y: null
					}
				},
				yAxis: {
					min: 0,
					title: {
						text: 'Rounds Fired'
					}
				},
				tooltip: {
					valueDecimals: 0,
					useHTML: true,
					followPointer: true,
					headerFormat: '<span style="font-size: 16px; color:{point.color}; font-weight: 500">{series.name}</span>',
					pointFormatter: function() {
						return '<table cellpadding="0" cellspacing="0" style="color: #EEE; text-align: left; font-size: 14px; white-space: nowrap">' +
							'<tr><th style="padding-right: 15px">Number of contacts fired in</th><td>' + Highcharts.numberFormat(this.contactCount, 0) + '</td></tr>' +
							'<tr><th style="padding-right: 15px">Rounds fired</th><td>' + Highcharts.numberFormat(this.y, 0) + '</td></tr>' +
							'</table>';
					}
				},
				legend: {
					reversed: true
				},
				plotOptions: {
					series: {
						stacking: 'normal'
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