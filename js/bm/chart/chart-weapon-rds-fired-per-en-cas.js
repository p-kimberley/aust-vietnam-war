/**
 * Shows incident frequency over time, grouped by date
 * @param {string} controlLabel
 * @param {string} chartTitle
 * @constructor
 * @extends {BM.Chart}
 */
BM.Chart.WeaponRdsFiredPerEnCas = function(controlLabel, chartTitle)
{
	BM.Chart.call(this, BM.ChartType.weapon.types.rndsFiredPerCasByUnitTask, controlLabel, chartTitle, false);
	this.helpTooltipText = '';
};

BM.Chart.WeaponRdsFiredPerEnCas.prototype = Object.create(BM.Chart.prototype);
BM.Chart.WeaponRdsFiredPerEnCas.prototype.constructor = BM.Chart.WeaponRdsFiredPerEnCas;

BM.Chart.WeaponRdsFiredPerEnCas.prototype.generateChart = function(callback)
{
	var self = this;
	var filterQuery = BM.FilterPanel.contactFilterController.toElasticSearchQuery();

	filterQuery.bool.must.push({
		"has_child": {
			"type": "weapon_effect",
			"query": {
				"match": {
					"Actor": "Friendly"
				}
			}
		}
	});

	$.ajax({
		url: '/api/es/search/avw_contacts',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 0,
			"query": filterQuery,
			"aggs": {
				"date_hist": {
					"date_histogram": {
						"field": "DTG",
						"interval": "day"
					},
					"aggs": {
						"unit_task": {
							"terms": {
								"field": "Unit_Task.raw",
								"size": 99
							},
							"aggs": {
								"avg_rds_fired": {
									"sum": {
										"script": "doc['Weapon_Effects.Rounds_Fired'].value / (doc['Total_En_Cas'].value | 1)"
									}
								}
							}
						}
					}
				}
			}
		})
	}).done(function(data) {
		var series = [];
		var unitTasks = {};

		$.each(data.aggregations.date_hist.buckets, function(i, item) {
			$.each(item.unit_task.buckets, function(i, unit_task)
			{
				var taskStats = unitTasks[unit_task.key];
				if (!taskStats)
					taskStats = unitTasks[unit_task.key] = {
						docCount: 0,
						data: []
					};

				taskStats.docCount += unit_task.doc_count;
				taskStats.data.push({
					x: item.key,
					y: unit_task.avg_rds_fired.value
				});
			});
		});

		for (var key in unitTasks)
		{
			var unitTask = unitTasks[key];
			series.push({
				name: key,
				docCount: unitTask.docCount,
				data: unitTask.data
			});
		}

		if (self.chartContainer)
		{
			var filterDescription = self.getAppliedFilterDescription();
			var chartOptions = self.mergeChartOptions(BM.ChartOptions.AreaDate, {
				chart: {
					type: 'spline',
					renderTo: self.chartContainer[0]
				},
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
						text: 'Average number of rounds fired'
					}
				},
				legend: {
					labelFormatter: function() {
						return this.name + ' (' + this.options.docCount + ')';
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
				series: series
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