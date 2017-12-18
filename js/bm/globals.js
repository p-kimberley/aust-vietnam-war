var BM = BM || {};

// Event argument object definitions are stored in this object
BM.Event = {};

// Main AngularJS app instance
BM.angularApp = angular.module('BM.angularApp', ['ngSanitize', 'ngAnimate']);

// Set the default Tooltipster tooltip options
$.tooltipster.setDefaults({
	maxWidth: 400,
	theme: ['tooltipster-default', 'battlemap-tooltip-dark']
});

BM.constants = {
	defaultModalBackgroundOpacity: 0.9,
	devicePixelRatio: (window.devicePixelRatio ? window.devicePixelRatio : 1)
};

// Stats queried during init. These are used as filter control limits
BM.filterLimits = {
	dateMin: 0,
	dateMax: 0,
	frStrengthMax: 0,
	frCasMax: 0,
	enStrengthMax: 0,
	enCasMax: 0
};

// Stores WordPress user profile details. Populated during initialisation
BM.currentWPUser = {
	ID: 0,
	login: false,
	email: false,
	firstName: false,
	lastName: false,
	displayName: false,
	avatar: '',
	editor: false,
	administrator: false
};

// Default options for Battle Map components
BM.options = {
	map: {
		zoom: 10,
		at: {
			lat: 10.96624136289212,
			lon: 107.13887302935599
		}
	},
	defaultFont: 'Segoe UI,Arial,sans-serif',
	incidentMediaBaseUrl: '/incident-media/',
	markerIconBaseUrl: '/images/markers/',
	spinner: {
		lines: 13, // The number of lines to draw
		length: 4, // The length of each line
		width: 2, // The line thickness
		radius: 5, // The radius of the inner circle
		corners: 1, // Corner roundness (0..1)
		rotate: 0, // The rotation offset
		direction: 1, // 1: clockwise, -1: counterclockwise
		color: '#000', // #rgb or #rrggbb or array of colors
		speed: 1, // Rounds per second
		trail: 60, // Afterglow percentage
		shadow: false, // Whether to render a shadow
		hwaccel: false, // Whether to use hardware acceleration
		className: 'loading-spinner', // The CSS class to assign to the spinner
		zIndex: 2e9, // The z-index (defaults to 2000000000)
		top: '0', // Top position relative to parent
		left: '0' // Left position relative to parent
	},
	tinySpinner: {
		lines: 17 // The number of lines to draw
		, length: 0 // The length of each line
		, width: 2 // The line thickness
		, radius: 6 // The radius of the inner circle
		, scale: 1 // Scales overall size of the spinner
		, corners: 0 // Corner roundness (0..1)
		, color: '#000' // #rgb or #rrggbb or array of colors
		, opacity: 0.25 // Opacity of the lines
		, rotate: 0 // The rotation offset
		, direction: 1 // 1: clockwise, -1: counterclockwise
		, speed: 1 // Rounds per second
		, trail: 60 // Afterglow percentage
		, fps: 20 // Frames per second when using setTimeout() as a fallback for CSS
		, zIndex: 2e9 // The z-index (defaults to 2000000000)
		, className: 'loading-spinner' // The CSS class to assign to the spinner
		, top: '50%' // Top position relative to parent
		, left: '12px' // Left position relative to parent
		, shadow: false // Whether to render a shadow
		, hwaccel: false // Whether to use hardware acceleration
		, position: 'relative' // Element positioning
	}
};