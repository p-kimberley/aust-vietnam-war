/**
 * Shows incident frequency over time, grouped by date
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.WeaponCasByRange = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.weapon.types.casByRange, controlLabel, chartTitle, false);
	this.helpTooltipText =
		'<span>' +
		'This chart displays the number of enemy casualties for each weapon type, against the engagement range in metres.' +
		'</span>';
};

BM.Chart.WeaponCasByRange.prototype = Object.create(BM.Chart.prototype);
BM.Chart.WeaponCasByRange.prototype.constructor = BM.Chart.WeaponCasByRange;

BM.Chart.WeaponCasByRange.prototype.generateChart = function(callback)
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
										"avg_cas": {
											"avg": {
												"field": "Affected_Asset.Casualties"
											}
										},
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
				var markerRadius = Math.round(Math.pow(weaponRange.doc_count + 1, 1/3) + 2);
				weaponStats.data.push({
					x: weaponRange.key ? weaponRange.key : 1,
					y: weaponRange.casualties.value,
					contacts: weaponRange.doc_count,
					roundsFired: weaponRange.rounds_fired.value,
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
					text: 'Bubble size: Number of contacts the weapon system was used in'
				},
				tooltip: {
					valueDecimals: 0,
					useHTML: true,
					headerFormat: '<span style="font-size: 16px; color:{point.color}; font-weight: 500">{series.name}</span>',
					pointFormatter: function() {
						return '<table cellpadding="0" cellspacing="0" style="color: #EEE; text-align: left; font-size: 14px; white-space: nowrap">' +
							'<tr><th style="padding-right: 15px">Engagement range (m)</th><td>' + this.x + '</td></tr>' +
							'<tr><th style="padding-right: 15px">Contacts</th><td>' + this.contacts + '</td></tr>' +
							'<tr><th style="padding-right: 15px">Avg rnds fired per contact</th><td>' + Highcharts.numberFormat(this.roundsFired, 0) + '</td></tr>' +
							'<tr><th style="padding-right: 15px">Avg cas per contact</th><td>' + Highcharts.numberFormat(this.y, 2) + '</td></tr>' +
							'</table>';
					}
				},
				xAxis: {
					title: {
						text: 'Engagement Range (metres)'
					},
					min: 0
				},
				yAxis: {
					title: {
						text: 'Average Casualties per Contact'
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