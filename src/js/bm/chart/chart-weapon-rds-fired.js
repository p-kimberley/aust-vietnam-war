/**
 * Shows incident frequency over time, grouped by date
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.WeaponUseByRange = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.weapon.types.rndsFiredByRange, controlLabel, chartTitle, false);
	this.helpTooltipText =
		'<span>' +
		'This chart displays the number of rounds fired by each weapon type, against the engagement range in metres.' +
		'</span>';
};

BM.Chart.WeaponUseByRange.prototype = Object.create(BM.Chart.prototype);
BM.Chart.WeaponUseByRange.prototype.constructor = BM.Chart.WeaponUseByRange;

BM.Chart.WeaponUseByRange.prototype.generateChart = function(callback)
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
				"weapon_effects": {
					"children": {
						"type": "weapon_effect"
					},
					"aggs": {
						"small_arms": {
							"filter": {
								"terms": {
									"Weapon.Category.raw": [
										"Small Arms",
										"Grenade",
										"Rocket"
									]
								}
							},
							"aggs": {
								"weapons": {
									"terms": {
										"field": "Weapon.Name.raw",
										"size": 50
									},
									"aggs": {
										"weapon_ranges": {
											"histogram": {
												"field": "Engagement_Range",
												"interval": 2
											},
											"aggs": {
												"rounds_fired": {
													"avg": {
														"field": "Rounds_Fired"
													}
												},
												"casualties": {
													"avg": {
														"field": "Affected_Asset.Casualties"
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
		var weaponBuckets = data.aggregations.weapon_effects.small_arms.weapons.buckets;
		var series = [];
		var weaponStats;

		$.each(weaponBuckets, function(i, weapon) {
			weaponStats = {
				name: weapon.key,
				data: []
			};

			$.each(weapon.weapon_ranges.buckets, function(j, weaponRange) {
				var markerRadius = Math.round((weaponRange.casualties.value * 3 + 2));
				weaponStats.data.push({
					x: weaponRange.key ? weaponRange.key : 1,
					y: weaponRange.rounds_fired.value,
					contacts: weaponRange.doc_count,
					casualties: weaponRange.casualties.value,
					marker: {
						symbol: 'circle',
						radius: markerRadius,
						states: {
							hover: {
								lineColor: 'rgb(255, 255, 255)',
								lineWidth: 2,
								radius: markerRadius
							}
						}
					}
				});
			});

			series.push(weaponStats);
		});

		if (self.chartContainer)
		{
			var chartOptions = self.mergeChartOptions(BM.ChartOptions.Scatter, {
				chart: {
					type: 'scatter',
					renderTo: self.chartContainer[0]
				},
				title: {
					text: self.chartTitle
				},
				subtitle: {
					text: 'Bubble size: Number of casualties by each weapon system'
				},
				xAxis: {
					title: {
						text: 'Engagement Range (metres)'
					},
					min: 0
				},
				tooltip: {
					valueDecimals: 0,
					useHTML: true,
					headerFormat: '<span style="font-size: 16px; color:{point.color}; font-weight: 500">{series.name}</span>',
					pointFormatter: function() {
						return '<table cellpadding="0" cellspacing="0" style="color: #EEE; text-align: left; font-size: 14px; white-space: nowrap">' +
							'<tr><th style="padding-right: 15px">Engagement range (m)</th><td>' + this.x + '</td></tr>' +
							'<tr><th style="padding-right: 15px">Contacts</th><td>' + this.contacts + '</td></tr>' +
							'<tr><th style="padding-right: 15px">Avg rnds fired per contact</th><td>' + Highcharts.numberFormat(this.y, 0) + '</td></tr>' +
							'<tr><th style="padding-right: 15px">Avg cas per contact</th><td>' + Highcharts.numberFormat(this.casualties, 2) + '</td></tr>' +
							'</table>';
					}
				},
				yAxis: {
					minTickInterval: 1,
					title: {
						text: 'Average Rounds Fired per Contact'
					}
				},
				plotOptions: {
					scatter: {
						marker: {
							symbol: 'circle',
							lineWidth: 1,
							lineColor: 'rgba(0, 0, 0, 0.5)'
						}
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