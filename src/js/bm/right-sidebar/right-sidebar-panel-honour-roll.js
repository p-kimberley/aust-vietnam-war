/**
 * Provides filtered lists of community notes: recent, pending moderation and those created by the logged in user
 * @extends {BM.RightSidebarPanel}
 * @constructor
 */
BM.RightSidebarPanel.HonourRoll = function()
{
	BM.RightSidebarPanel.call(this, 'honour-roll', '#right-sidebar-button-honour-roll', '#right-sidebar-panel-honour-roll', true);

	var panel = $(this.panelElement);
	this.searchBox = panel.find('input.search');

	var self = this;
	BM.angularApp.controller('honourRollController', ['$scope', '$http', '$log', 'BM.services.utility', 'BM.services.honourRoll', function($scope, $http, $log, utilityServices, honourRollServices) {
		self.scope = $scope;
		$scope.honourRollServices = honourRollServices;
		$scope.selectedCategory = "Service";
		$scope.searchTerm = "";
		$scope.categories = [];

		$scope.updateHonourRoll = function()
		{
			var multiMatch = ($scope.searchTerm == "" ? {} : {
					"multi_match": {
						"query": $scope.searchTerm,
						"type": "phrase_prefix",
						"fields": [
							"Last_Name",
							"First_Name",
							"Second_Name",
							"Third_Name"
						]
					}
				});

			$http.post('/api/es/search/avw_nomroll', {
				"size": 0,
				"query": {
					"bool": {
						"must": [
							{
								"range": {
									"Death.Date": {
										"gte": null
									}
								}
							},
							multiMatch
						]
					}
				},
				"aggs": {
					"categories": {
						"terms": {
							"field": $scope.selectedCategory + ".raw",
							"size": 99
						},
						"aggs": {
							"people": {
								"top_hits": {
									"size": 999
								}
							}
						}
					}
				}
			}).then(function(response) {
				$scope.categories = response.data.aggregations.categories.buckets;

			}, function (error) {
				InfoDialog('Casualty Details', 'Nominal roll details could not be queried. Please refresh the page and try again.<br/><br/>Error ' + error.status + " " + error.statusText);
				$log.error(error);
			});
		};

		$scope.togglePanelHeader = function(event)
		{
			self.togglePanelHeader(event);
		};
	}]);
};

BM.RightSidebarPanel.HonourRoll.prototype = Object.create(BM.RightSidebarPanel.prototype);
BM.RightSidebarPanel.HonourRoll.prototype.constructor = BM.RightSidebarPanel.HonourRoll;

BM.RightSidebarPanel.HonourRoll.prototype.init = function()
{};

/**
 * Populates honour roll when activated
 * @param [skipAnimation]
 */
BM.RightSidebarPanel.HonourRoll.prototype.show = function(skipAnimation)
{
	BM.RightSidebarPanel.prototype.show.call(this);

	this.scope.updateHonourRoll();
	this.searchBox.focus();
};