
BM.LogEventTypes = {
	openedIncidentFromMap: 'opened-incident-from-map',
	openedIncidentNote: 'opened-incident-note',
	openedMediaItemFromMap: 'opened-media-item-from-map',
	addedIncidentNote: 'added-incident-note',
	addedIncidentNoteComment: 'added-incident-note-comment',
	openedChart: 'opened-chart',
	appliedFilter: 'applied-filter',
	selectedLayer: 'selected-layer',
	openedMediaItem: 'opened-media-item',
	startedTour: 'started-tour'
};

BM.ActivityLogging = (function()
{
	/**
	 * Adds an event to the activity log on the server, for internal user pattern analysis
	 * @param {BM.LogEventTypes,*} eventType
	 * @param {Number} [eventKey] - Assigns a foreign key for efficient lookup based on the event type
	 * @param {string} [eventData]
	 * @private
	 */
	function _logEvent(eventType, eventKey, eventData)
	{
		if (BM.StateManagement.initialStateLoaded())
		{
			$.post('/src/php/bm/log-user-activity.php', {
				eventType: eventType,
				eventKey: eventKey,
				eventData: eventData
			});
		}
	}

	return {
		logEvent: _logEvent
	};
})();