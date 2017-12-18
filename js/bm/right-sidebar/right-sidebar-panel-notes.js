/**
 * Provides filtered lists of community notes: recent, pending moderation and those created by the logged in user
 * @extends {BM.RightSidebarPanel}
 * @constructor
 */
BM.RightSidebarPanel.Notes = function()
{
	BM.RightSidebarPanel.call(this, 'notes', '#right-sidebar-button-notes', '#right-sidebar-panel-notes', true);

	var self = this;
	BM.angularApp.controller('recentIncidentNoteController', ['$scope', '$http', '$log', 'BM.services.incidentNote', function($scope, $http, $log, incidentNoteServices) {
		self._scope = $scope;
		$scope.incidentNoteServices = incidentNoteServices;
		$scope.emptyMessage = 'No notes have been added recently.';
		$scope.fromDate = moment().subtract(1, 'months').toDate();

		/**
		 * Retrieves incident notes submitted in the past month
		 */
		$scope.getIncidentNotes = function()
		{
			var retrieveAll = (BM.currentWPUser.administrator || BM.currentWPUser.editor);
			var fromDate = moment($scope.fromDate).toISOString();

			var query = {
				"bool": {
					"must": [
						{
							"range": {
								"Approval_Status_Changed": {
									"gte": fromDate
								}
							}
						},
						{
							"range": {
								"Created": {
									"gte": fromDate
								}
							}
						}
					]
				}
			};

			if (!retrieveAll)
			{
				query.bool.must.push({
					"match": {
						"Author.ID": BM.currentWPUser.ID
					}
				});
			}

			$http.post('/api/es/search/avw_incident_notes', {
				"query": query
			}).then(function (response) {
				$scope.notes = response.data.hits.hits;
			}, function (error) {
				$log.error(error);
			});
		};

		$scope.getIncidentNotes();
	}]);
	BM.angularApp.controller('pendingIncidentNoteController', ['$scope', '$http', '$log', 'BM.services.incidentNote', function($scope, $http, $log, incidentNoteServices) {
		self.pendingNoteListScope = $scope;
		$scope.incidentNoteServices = incidentNoteServices;
		$scope.emptyMessage = 'No notes are pending approval.';

		$scope.getIncidentNotes = function()
		{
			$http.post('/api/es/search/avw_incident_notes', self.getIncidentNotesQuery(undefined, -1)).then(function (response) {
				$scope.notes = response.data.hits.hits;
			}, function (error) {
				$log.error(error);
			});
		};

		$scope.getIncidentNotes();
	}]);
	BM.angularApp.controller('userIncidentNoteController', ['$scope', '$http', '$log', 'BM.services.incidentNote', function($scope, $http, $log, incidentNoteServices) {
		self.userNoteListScope = $scope;
		$scope.incidentNoteServices = incidentNoteServices;
		$scope.emptyMessage = 'You have not yet submitted any incident notes.';

		$scope.getIncidentNotes = function()
		{
			$http.post('/api/es/search/avw_incident_notes', self.getIncidentNotesQuery(BM.currentWPUser.ID)).then(function (response) {
				$scope.notes = response.data.hits.hits;
			}, function (error) {
				$log.error(error);
			});
		};

		$scope.getIncidentNotes();
	}]);
};

BM.RightSidebarPanel.Notes.prototype = Object.create(BM.RightSidebarPanel.prototype);
BM.RightSidebarPanel.Notes.prototype.constructor = BM.RightSidebarPanel.Notes;

BM.RightSidebarPanel.Notes.prototype.init = function()
{
	// Hide the 'Pending Approval' from regular users
	if (!(BM.currentWPUser.editor || BM.currentWPUser.administrator))
		$('#note-list-pending-approval, #note-list-pending-approval-heading').hide();
};

/**
 * Requery the datasource and refresh the note lists
 */
BM.RightSidebarPanel.Notes.prototype.refreshNoteLists = function()
{
	this._scope.getIncidentNotes();
	this.pendingNoteListScope.getIncidentNotes();
	this.userNoteListScope.getIncidentNotes();
};

/**
 * Refresh the note lists on panel activation
 * @param {boolean} skipAnimation
 */
BM.RightSidebarPanel.Notes.prototype.show = function(skipAnimation)
{
	BM.RightSidebarPanel.prototype.show.call(this, skipAnimation);

	var self = this;
	setTimeout(function() {
		self.refreshNoteLists();
	}, 500);
};

/**
 * Gets incident notes, optionally filtered by userId and approvalStatus
 * @param {number} [authorId]
 * @param {number} [approvalStatus]
 * @returns {{}}
 */
BM.RightSidebarPanel.Notes.prototype.getIncidentNotesQuery = function(authorId, approvalStatus)
{
	var conditions = [];

	if (authorId !== undefined)
		conditions.push({ "match": { "Author.ID": authorId }});
	if (approvalStatus !== undefined)
		conditions.push({ "match": { "Approval_Status": approvalStatus }});
	if (!BM.currentWPUser.administrator && !BM.currentWPUser.editor)
		conditions.push({ "match": { "Author.ID": BM.currentWPUser.ID }});

	return {
		"size": 1000,
		"query": {
			"bool": {
				"must": conditions
			}
		}
	};
};