BM.ChartOptions = BM.ChartOptions || {};

BM.ChartOptions.colours = {
	enemyKIA: '#C90000',
	enemyWIA: '#FF8400',
	friendlyKIA: '#2E26FF',
	friendlyWIA: '#29BFFF',
	contact: '#C90000',
	mineIncident: '#383838'
};

/**
 * Default chart options for BattleMap charts
 * @type {{}}
 */
BM.ChartOptions.Base = {
	chart: {
		backgroundColor: 'rgba(255,255,255,0.6)',
		borderWidth: 1,
		borderColor: '#888',
		borderRadius: 0,
		spacingTop: 15,
		spacingLeft: 15,
		spacingRight: 20,
		style: {
			fontFamily: BM.options.defaultFont
		}
	},
	colors: ['#7cb5ec', '#8e1010', '#90ed7d', '#f7a35c', '#8085e9', '#f15c80', '#e4d354', '#8d4653', '#91e8e1', '#0048f0', '#106100'],
	title: {
		margin: 15,
		style: {
			color: '#000',
			fontSize: 20,
			fontWeight: 'bold',
			textTransform: 'none'
		}
	},
	subtitle: {
		style: {
			color: '#333',
			fontSize: 16,
			textTransform: 'none'
		}
	},
	credits: {
		enabled: false
	},
	navigator: {
		enabled: false
	},
	scrollbar: {
		enabled: false
	},
	tooltip: {
		headerFormat: '<span style="font-size: 14px">{point.key}</span><br/>',
		style: {
			fontSize: 14
		}
	},
	xAxis: {
		title: {
			margin: 10,
			style: {
				color: '#000',
				fontSize: 16,
				fontWeight: 'bold'
			}
		},
		labels: {
			y: 25,
			style: {
				color: '#000',
				fontSize: 14
			}
		},
		lineColor: 'rgba(0,0,0,0.8)'
	},
	yAxis: {
		title: {
			margin: 15,
			style: {
				color: '#000',
				fontSize: 16,
				fontWeight: 'bold'
			}
		},
		labels: {
			style: {
				color: '#000',
				fontSize: 14
			}
		},
		tickColor: '#CCC',
		gridLineColor: '#CCC'
	},
	legend: {
		enabled: true,
		itemStyle: {
			color: '#000',
			fontSize: 16,
			fontWeight: 'normal'
		},
		highlightSeries: {
			enabled: true
		}
	}
};

BM.ChartOptions.AreaDate = {
	chart: {
		type: 'area',
		zoomType: 'x'
	},
	rangeSelector: {
		inputEnabled: false,
		buttonSpacing: 10,
		labelStyle: {
			color: '#000',
			fontFamily: BM.options.defaultFont,
			fontWeight: 'bold',
			fontSize: 14
		},
		buttonTheme: {
			fill: '#4F381A',
			stroke: '#301D03',
			'stroke-width': 1,
			r: 2,
			width: 70,
			height: 18,
			style: {
				fontSize: 14
			},
			states: {
				hover: {
					fill: '#EF8500',
					style: {
						color: '#333'
					}
				},
				select: {
					fill: '#222',
					stroke: 'rgba(255,255,255,0.6)'
				}
			}
		},
		selected: 3,
		buttons: [{
			type: 'month',
			count: 1,
			text: '1 month'
		}, {
			type: 'month',
			count: 6,
			text: '6 months'
		}, {
			type: 'year',
			count: 1,
			text: '1 year'
		}, {
			type: 'all',
			text: 'All'
		}]
	},
	xAxis: {
		type: 'datetime',
		minTickInterval: 24 * 3600 * 1000,     // Minimum selected period: 1 day
		minRange: 24 * 3600 * 1000,
		dateTimeLabelFormats: {
			day: "%e %b %y",
			week: '%e %b',
			month: '%b %y',
			year: '%Y'
		},
		labels: {
			style: {
				color: '#000',
				fontSize: 12
			}
		},
		ordinal: false
	},
	yAxis: {
		opposite: false,
		labels: {
			style: {
				color: '#000',
				fontSize: 12
			}
		}
	},
	tooltip: {
		crosshairs: [{
			width: 1,
			color: 'rgba(0,0,0,0.4)'
		}]
	},
	plotOptions: {
		series: {
			stacking: 'normal',
			connectNulls: true,
			dataGrouping: {
				approximation: 'sum',
				dateTimeLabelFormats: {
					day: ['%A, %e %b %Y', '%A, %e %b', '-%A, %e %b %Y'],
					week: ['Week from %A, %e %b %Y', '%A, %e %b', '-%A, %e %b %Y'],
					month: ['%B %Y', '%B', '-%B %Y'],
					year: ['%Y', '%Y', '-%Y']
				},
				groupPixelWidth: 30
			},
			tooltip: {
				xDateFormat: "%A, %e %b %y"
			}
		}
	}
};

$.extend(true, BM.ChartOptions.AreaDate, BM.ChartOptions.Base);

BM.ChartOptions.Column = {
	chart: {
		type: 'column'
	},
	xAxis: {
		tickInterval: 1
	},
	plotOptions: {
		column: {
			borderColor: '#333'
		},
		series: {
			stacking: 'normal'
		}
	}
};

$.extend(true, BM.ChartOptions.Column, BM.ChartOptions.Base);

BM.ChartOptions.Pie = {
	chart: {
		type: 'pie'
	},
	plotOptions: {
		pie: {
			dataLabels: {
				color: '#000'
			}
		}
	}
};

$.extend(true, BM.ChartOptions.Pie, BM.ChartOptions.Base);

BM.ChartOptions.Pie3d = {
	chart: {
		type: 'pie',
		options3d: {
			enabled: true,
			alpha: 45,
			beta: 0
		}
	},
	plotOptions: {
		pie: {
			depth: 35,
			dataLabels: {
				color: '#000'
			}
		}
	}
};

$.extend(true, BM.ChartOptions.Pie3d, BM.ChartOptions.Base);

BM.ChartOptions.Bubble = {
	chart: {
		type: 'bubble',
		zoomType: 'x'
	},
	rangeSelector: {
		inputEnabled: false,
		buttonSpacing: 10,
		labelStyle: {
			color: '#000',
			fontFamily: BM.options.defaultFont,
			fontWeight: 'bold',
			fontSize: 14
		},
		buttonTheme: {
			fill: '#4F381A',
			stroke: '#301D03',
			'stroke-width': 1,
			r: 2,
			width: 65,
			height: 18,
			style: {
				fontSize: 14
			},
			states: {
				hover: {
					fill: '#EF8500',
					style: {
						color: '#333'
					}
				},
				select: {
					fill: '#222',
					stroke: 'rgba(255,255,255,0.6)'
				}
			}
		},
		selected: 3,
		buttons: [{
			type: 'month',
			count: 1,
			text: '1 month'
		}, {
			type: 'month',
			count: 6,
			text: '6 months'
		}, {
			type: 'year',
			count: 1,
			text: '1 year'
		}, {
			type: 'all',
			text: 'All'
		}]
	},
	xAxis: {
		type: 'datetime',
		minTickInterval: 24 * 3600 * 1000,     // Minimum selected period: 1 day
		minRange: 24 * 3600 * 1000,
		dateTimeLabelFormats: {
			day: '%e %b %y',
			week: '%e %b',
			month: '%b %y',
			year: '%Y'
		},
		labels: {
			style: {
				color: '#000',
				fontSize: 12
			}
		}
	},
	yAxis: {
		opposite: false,
		labels: {
			style: {
				color: '#000',
				fontSize: 12
			}
		}
	},
	tooltip: {
		crosshairs: [{
			width: 1,
			color: 'rgba(0,0,0,0.4)'
		}]
	},
	plotOptions: {
		series: {
			stacking: 'normal',
			connectNulls: false,
			dataGrouping: {
				approximation: 'sum',
				dateTimeLabelFormats: {
					day: ['%A, %e %b %Y', '%A, %e %b', '-%A, %e %b %Y'],
					week: ['Week from %A, %e %b %Y', '%A, %e %b', '-%A, %e %b %Y'],
					month: ['%B %Y', '%B', '-%B %Y'],
					year: ['%Y', '%Y', '-%Y']
				},
				groupPixelWidth: 13
			},
			tooltip: {
				xDateFormat: "%A, %e %b %y"
			}
		}
	}
};

$.extend(true, BM.ChartOptions.Bubble, BM.ChartOptions.Base);

BM.ChartOptions.Scatter = {
	chart: {
		type: 'scatter',
		zoomType: 'xy'
	},
	xAxis: {
		labels: {
			style: {
				fontSize: 12
			}
		},
		startOnTick: true,
		endOnTick: true
	},
	yAxis: {
		labels: {
			style: {
				fontSize: 12
			}
		}
	},
	plotOptions: {
		scatter: {
			stickyTracking: false
		}
	},
	tooltip: {
		style: {
			fontSize: 14
		}
	}
};

$.extend(true, BM.ChartOptions.Scatter, BM.ChartOptions.Base);