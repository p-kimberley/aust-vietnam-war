/**
 * Enables the user to customise the map using different combinations of layers and overlays.
 * Coordinates the initialisation of layers.
 * @extends {BM.RightSidebarPanel}
 * @constructor
 */
BM.RightSidebarPanel.Marker = function ()
{
	BM.RightSidebarPanel.call(this, 'marker', '#right-sidebar-button-marker', '#right-sidebar-panel-marker', false);

	var self = this;
	this.currentIncidentID = 0;
	this.selectedMarker = null;
	this.currentNoteID = 0;
	this.incidentDetails = $('#incident-context-panel');

	/** @type {BM.GuidanceLine} */
	this.guidanceLine = new BM.GuidanceLine(null, $('#right-sidebar-panels'), [0, 160], 'rgba(0, 0, 0, 0.8)', 'rgba(255, 255, 255, 0.6)');

	BM.angularApp.controller('incidentDetailsController', ['$scope', '$http', '$log', 'BM.services.utility', 'BM.services.honourRoll', function ($scope, $http, $log, utilityServices, honourRollServices)
		{
			self.incidentDetailsScope = $scope;
			$scope.honourRollServices = honourRollServices;
			$scope.userAddCas = {
				hover: false,
				active: false
			};

			$scope.getIncidentData = function (incidentID)
			{
				DisplayLoadingIndicator($(self.panelElement), "Loading...", null, "rgba(255, 255, 255, 0.8)");

				$scope.incidentData = undefined;
				$scope.casualties = [];

				// Get incident statistics
				$http.get('/api/es/search/avw_contacts/contact/' + incidentID)
					.then(function (response) {
						$scope.incidentData = response.data;
						HideLoadingIndicator($(self.panelElement));
					}, function (error) {
						InfoDialog('Incident Details', 'Details for incident ' + incidentID + ' could not be queried. Please refresh the page and try again.<br/><br/>Error ' + error.status + " " + error.statusText);
						$log.error(error);
					});

				$http.post('/api/es/search/avw_nomroll', {
					"query": {
						"match": {
							"Death.Incident_ID": incidentID
						}
					}
				}).then(function(response) {
					$scope.casualties = response.data.hits.hits;
				}, function (error) {
					InfoDialog('Casualty Details', 'Casualty details for incident ' + incidentID + ' could not be queried. Please refresh the page and try again.<br/><br/>Error ' + error.status + " " + error.statusText);
					$log.error(error);
				});
			};

			$scope.hasCasualties = function()
			{
				if ($scope.incidentData)
					return $scope.incidentData._source.Fr_KIA || $scope.incidentData._source.Fr_WIA;
				else
					return false;
			};

			$scope.getDateTime = function (data)
			{
				if (data)
					return moment.utc(data.DTG).format('ddd, DD MMM YYYY HH:mm');
			};

			$scope.followUnit = function(unit, incidentId)
			{
				var unitTracker = BM.TimelineTracker.getTrackTypes().trackTypeUnit;
				BM.TimelineTracker.setTrackType(unitTracker);
				BM.TimelineTracker.setActive(true);
				BM.TimelineTracker.setTrackTarget(unit.ID, incidentId);
			};

			$scope.addIncidentNote = function (incidentID)
			{
				BM.IncidentNote.addNote(incidentID);
			};

			$scope.promptKIAContribution = function(incidentID)
			{
				if (!utilityServices.isUserLoggedIn())
				{
					RedirectToLoginPage();
					return;
				}

				var casDialogEl = $('#dialog-casualty-submit-info');
				var namesList = casDialogEl.find('.kia-personnel');
				var casTypeList = casDialogEl.find('.cas-type');
				var notes = casDialogEl.find('.additional-notes');

				namesList.empty();
				$.ajax({
					url: '/api/es/search/avw_nomroll',
					method: 'POST',
					dataType: 'json',
					contentType: 'application/json',
					data: JSON.stringify({
						"query": {
							"bool": {
								"filter": {
									"exists": {
										"field": "Death.Date"
									}
								}
							}
						},
						"sort": ["Last_Name", "First_Name"],
						"_source": {
							"include": ["Service_Number", "Last_Name", "First_Name", "Second_Name", "Rank", "Service"]
						}
					})
				}).done(function(response) {
					$.each(response.hits.hits, function(i, person) {
						var fields = person._source;
						namesList.append('<option value="' + fields.Service_Number + '">' +
							fields.Last_Name + ', ' + fields.First_Name + (fields.Second_Name ? ' ' + fields.Second_Name : '') + ', ' + fields.Rank + ', ' + fields.Service + ', ' + fields.Service_Number +
						'</option>');
					});

					namesList.select2({
						placeholder: 'Select one or more names'
					});
				});

				casDialogEl.dialog({
					modal: false,
					show: {
						effect: 'fade',
						duration: 300
					},
					hide: {
						effect: 'fade',
						duration: 300
					},
					width: 600,
					title: 'Submit Casualty Details on this Incident',
					buttons: [{
						text: "Cancel",
						click: function () {
							$(this).dialog('close');
						}
					}, {
						text: "Submit",
						class: 'default',
						click: function() {
							if (!namesList.val())
							{
								InfoDialog('Incomplete Data', 'Select one or more names before submitting.');
								return;
							}

							$.post('/src/php/bm/record-casualty-information.php', JSON.stringify({
								incidentID: incidentID,
								casType: encodeURIComponent(casTypeList.val()),
								casData: encodeURIComponent(namesList.val().toString()),
								comment: encodeURIComponent(notes.val())
							})).done(function() {
								casDialogEl.dialog('close');
								InfoDialog('Casualty Information Submitted',
									'<p>Thanks for submitting.</p>' +
									'<p>We will review your submission shortly. We may contact you if we have questions or require further information.</p>' +
									'<p>Your information will help us improve our record of Vietnam wartime casualties.</p>');
							}).fail(function() {
								InfoDialog('Submission Failed', 'Your submission could not be completed. Please try again or <a href="/contact">contact us</a>.');
							});
						}
					}]
				});

				casDialogEl.find('.incident-id').html('<span>' + incidentID + '</span>');
				casTypeList.selectmenu({
					width: 150
				});
			}
		}]);

	BM.angularApp.controller('noteByIncidentController', ['$scope', '$http', '$log', 'BM.services.incidentNote',
		function ($scope, $http, $log, incidentNoteServices)
		{
			self.incidentNoteListScope = $scope;
			$scope.incidentNoteServices = incidentNoteServices;
			$scope.emptyMessage = '<p>There are no notes relating to this incident.</p>' +
				'<p>Do you know something about this incident or were you there? ' +
				'Share your perspective with other users of this site by adding a note.</p>';

			$scope.getIncidentNotes = function (incidentID)
			{
				if (incidentID)
				{
					$http.post('/api/es/search/avw_incident_notes', {
						"size": 1000,
						"query": {
							"match": {
								"Incident_ID": incidentID
							}
						}
					}).then(function (response) {
						$scope.notes = response.data.hits.hits;
					}, function (error) {
						$scope.notes = null;
					});
				}
				else
				{
					$log.log('Warning: Incident ID was not provided to noteByIncidentController.');
				}
			};
		}]);
};

BM.RightSidebarPanel.Marker.prototype = Object.create(BM.RightSidebarPanel.prototype);
BM.RightSidebarPanel.Marker.prototype.constructor = BM.RightSidebarPanel.Marker;

BM.RightSidebarPanel.Marker.prototype.init = function ()
{
	this.incidentDetails.find('div').tooltipster({
		side: 'left',
		distance: 0
	});
};

/**
 * Displays the marker context panel for a marker by its ID
 * @param {Number} incidentID
 * @param {boolean} [panTo] - Whether to pan the map view to the incident location
 * @param {Number} [animationDuration] - If panTo is TRUE, animate for this number of milliseconds
 * @returns {boolean} - TRUE if the incident was opened, FALSE if not matching incident was found
 */
BM.RightSidebarPanel.Marker.prototype.showForIncidentByID = function (incidentID, panTo, animationDuration)
{
	var contactLayer = BM.LayerPanel.layerController.getSelectedLayerInGroup(BM.LayerGroupType.contact);
	if (contactLayer)
	{
		var marker = contactLayer.getMarkerByID(incidentID);
		if (marker)
		{
			this.showForIncident(marker, panTo, animationDuration);
			return true;
		}
	}

	return false;
};

/**
 * @param {ol.Feature} marker
 * @param {boolean} [panTo] - Whether to pan the map view to the incident location
 * @param {Number} [animationDuration] - If panTo is TRUE, animate for this number of milliseconds
 */
BM.RightSidebarPanel.Marker.prototype.showForIncident = function (marker, panTo, animationDuration)
{
	var self = this;
	var contactLayer = BM.LayerPanel.layerController.getSelectedLayerInGroup(BM.LayerGroupType.contact);

	if (contactLayer)
	{
		if (marker)
		{
			this.currentIncidentID = contactLayer.getMarkerID(marker);
			if (this.selectedMarker)
				this.selectedMarker.set('selected', false);

			this.selectedMarker = marker;
			this.selectedMarker.set('selected', true);

			if (panTo)
			{
				var view = BM.map.getView();
				view.animate({
					center: marker.getGeometry().getCoordinates(),
					duration: animationDuration,
					easing: ol.easing.inAndOut
				});
			}

			BM.RightSidebar.showPanel(BM.MarkerPanel, function ()
			{
				// Move the guidance line to the new marker position
				var coords = marker.getGeometry().getCoordinates();
				self.guidanceLine.setMapTargetCoords(coords);
				self.setEnabled(true);
			});

			this.incidentDetailsScope.getIncidentData(this.currentIncidentID);
			this.incidentNoteListScope.getIncidentNotes(this.currentIncidentID);
			BM.StateManagement.pushState();
		}
	}
};

BM.RightSidebarPanel.Marker.prototype.deselectIncident = function ()
{
	if (this.selectedMarker)
		this.selectedMarker.set('selected', false);

	this.hide();
	this.currentIncidentID = 0;
	this.selectedMarker = null;
	this.currentNoteID = 0;
	this.setEnabled(false);
	BM.StateManagement.replaceState();
};

BM.RightSidebarPanel.Marker.prototype.show = function (skipAnimation)
{
	var self = this;
	BM.RightSidebarPanel.prototype.show.call(this, skipAnimation);

	setTimeout(function ()
	{
		self.guidanceLine.updateGeometry();
		self.guidanceLine.show();
		BM.map.on('pointerdrag', self.guidanceLine.updateGeometry, self.guidanceLine);
		BM.map.on('moveend', self.guidanceLine.updateGeometry, self.guidanceLine);
	}, 500);
};

BM.RightSidebarPanel.Marker.prototype.hide = function ()
{
	BM.RightSidebarPanel.prototype.hide.call(this);

	this.guidanceLine.hide();
	BM.map.un('pointerdrag', this.guidanceLine.updateGeometry, this.guidanceLine);
	BM.map.un('moveend', this.guidanceLine.updateGeometry, this.guidanceLine);
};

/**
 * @returns {number}
 */
BM.RightSidebarPanel.Marker.prototype.getCurrentIncidentID = function ()
{
	return this.currentIncidentID;
};

/**
 * @returns {ol.Feature|null}
 */
BM.RightSidebarPanel.Marker.prototype.getSelectedMarker = function ()
{
	return this.selectedMarker;
};

/**
 * @returns {number}
 */
BM.RightSidebarPanel.Marker.prototype.getCurrentNoteID = function ()
{
	return this.currentNoteID;
};

/**
 * Requeries the notes related to this incident, such as when a new note is added
 */
BM.RightSidebarPanel.Marker.prototype.refreshNoteList = function ()
{
	this.incidentNoteListScope.getIncidentNotes(this.currentIncidentID);
};