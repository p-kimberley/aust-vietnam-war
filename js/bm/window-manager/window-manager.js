
// Manages the viewable area.
// Will ultimately allow for components to be docked to certain areas of the screen.
BM.WindowManager = (function() {
	var _maximisedComponents = [];

	/**
	 * A component is opening that will occlude the map area.
	 * Map interactions will be disabled while any maximised components are visible.
	 * @param {string} key - Identifies the component being opened
	 * @private
	 */
	function _openMaximised(key)
	{
		if (!_maximisedComponents.length)
			$('body').trigger('bm:maximised.start');

		_maximisedComponents.push(key);
	}

	/**
	 * A maximised component is closed.
	 * If all maximised components are closed, map interactions are re-enabled.
	 * @param {string} key
	 * @private
	 */
	function _closeMaximised(key)
	{
		$.each(_maximisedComponents, function(i, item) {
			if (item === key)
				_maximisedComponents.splice(i, 1);
		});

		if (!_maximisedComponents.length)
			$('body').trigger('bm:maximised.end');
	}

	function _requestFullscreen()
	{
		var elem = $('body')[0];
		if (elem.requestFullscreen) {
			elem.requestFullscreen();
		} else if (elem.msRequestFullscreen) {
			elem.msRequestFullscreen();
		} else if (elem.mozRequestFullScreen) {
			elem.mozRequestFullScreen();
		} else if (elem.webkitRequestFullscreen) {
			elem.webkitRequestFullscreen();
		}
	}

	function _exitFullscreen()
	{
		if(document.exitFullscreen) {
			document.exitFullscreen();
		} else if (document.mozCancelFullScreen) {
			document.mozCancelFullScreen();
		} else if (document.webkitExitFullscreen) {
			document.webkitExitFullscreen();
		}
	}

	return {
		openMaximised: _openMaximised,
		closeMaximised: _closeMaximised,
		requestFullscreen: _requestFullscreen,
		exitFullscreen: _exitFullscreen
	};
})();