
BM.LoadingProgress = (function()
{
	var _progressContainer = $('#loading-progress-container');
	var _progressBar = _progressContainer.find('.progress');
	var _progressValue = 0;
	var _progressMax = 100;
	var _isShowing = false;
	var _isIndeterminate = false;

	function _init(statusHeading, statusMessage, isIndeterminate)
	{
		_isIndeterminate = isIndeterminate;

		// Destroy the progress bar if it already exists
		if (_progressBar.progressbar('instance'))
			_progressBar.progressbar('destroy');

		_progressBar.progressbar({
			max: _progressMax
		});

		_setStatusMessage(statusHeading, statusMessage);

		if (isIndeterminate)
			_progressBar.progressbar('option', 'value', false);
		else
			_progressBar.progressbar('option', 'value', 0);
	}

	function _show(callback)
	{
		if (!_isShowing)
		{
			_isShowing = true;
			DoModal(true);

			var mainContainer = $('#main-container');
			_progressContainer
				.css('top', mainContainer.height() / 2 - _progressContainer.height() / 2)
				.css('left', mainContainer.width() / 2 - _progressContainer.outerWidth() / 2);

			_progressContainer.fadeIn(300, function ()
			{
				if (callback)
					callback();
			});
		}
		else if (callback)
		{
			callback();
		}
	}

	function _hide(callback)
	{
		if (_isShowing)
		{
			_isShowing = false;
			DoModal(false);
			_progressContainer.fadeOut(300, function ()
			{
				if (callback)
					callback();
			});
		}
		else if(callback)
		{
			callback();
		}
	}

	// Changes just the status message
	function _setStatusMessage(heading, message)
	{
		_progressContainer.find('.heading').html(heading);
		_progressContainer.find('.message').html(message);
	}

	return {
		progressValue: _progressValue,
		init: _init,
		show: _show,
		hide: _hide,
		setStatusMessage: _setStatusMessage,

		// Sets the progress value and (optionally) the accompanying status message
		update: function(newValue, statusMessage)
		{
			if (statusMessage && statusMessage != "")
				this.setStatusMessage(statusMessage);

			_progressValue = newValue;
			_progressBar.progressbar('option', 'value', _progressValue);
		},

		// Increments the progress by a specified amount
		step: function(stepAmount)
		{
			_progressValue = _progressValue + stepAmount;
			if (_progressValue > _progressMax)
				_progressValue = _progressMax;

			_progressBar.progressbar('option', 'value', _progressValue);
		}
	}
})();