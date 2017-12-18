
BM.angularApp.service('BM.services.media', ['$http', function($http) {
	/**
	 * Changes the approval status of a media item
	 * @param {[number]} mediaItemIDs
	 * @param {number} approvalStatus - 0: Unapproved, 1: Approved, -1: No status
	 * @returns {HttpPromise}
	 */
	this.setApprovalStatus = function(mediaItemIDs, approvalStatus)
	{
		return $http.post('/php/bm/update-media-approval-status.php', {
			mediaItemIDs: mediaItemIDs.toString(),
			approvalStatus: approvalStatus
		});
	};
}]);