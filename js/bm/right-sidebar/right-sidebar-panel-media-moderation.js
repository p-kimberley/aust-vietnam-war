/**
 * Provides filtered lists of community notes: recent, pending moderation and those created by the logged in user
 * @extends {BM.RightSidebarPanel}
 * @constructor
 */
BM.RightSidebarPanel.MediaModeration = function()
{
	BM.RightSidebarPanel.call(this, 'media-moderation', '#right-sidebar-button-media-moderation', '#right-sidebar-panel-media-moderation', true);

	var self = this;
	BM.angularApp.controller('mediaModerationController', ['$scope', '$http', '$log', 'BM.services.utility', 'BM.services.media', function($scope, $http, $log, utilityServices, mediaServices) {
		self._scope = $scope;

		$scope.utilityServices = utilityServices;
		$scope.mediaServices = mediaServices;
		$scope.dateGroups = [];

		/**
		 * Retrieves incident notes submitted in the past month
		 */
		$scope.getMediaForModeration = function()
		{
			$http.post('/api/es/search/avw_incident_media', {
				"size": 1000,
				"query": {
					"match": {
						"Approval_Status": -1
					}
				},
				"sort": [{
					"Created": "desc"
				}]
			}).then(function (response) {
				$scope.dateGroups = [];
				var currentDate = null;
				var currentDateGroup = null;
				$.each(response.data.hits.hits, function (i, item)
				{
					var itemDate = moment(item.Created, 'YYYY-MM-DD').valueOf();
					if (currentDate !== itemDate)
					{
						// If the current date being processed is different, start a new date in the collection
						if (currentDateGroup)
						{
							$scope.dateGroups.push(currentDateGroup);
							currentDateGroup = null;
						}

						currentDate = itemDate;
					}

					// Date is the same, so insert the current item into the array at this date
					if (!currentDateGroup)
					{
						currentDateGroup = {
							date: currentDate,
							items: [item]
						};
					}
					else
					{
						currentDateGroup.items.push(item);
					}
				});

				// If there is a last residual item, push it to the array
				if (currentDateGroup)
					$scope.dateGroups.push(currentDateGroup);
			}, function (error) {
				$log.error(error);
			});
		};

		/**
		 * Sets the approval status for a single media item
		 */
		$scope.approveMediaItem = function(dateGroup, mediaItem, approve)
		{
			// Disallow more than one attempt to change the status
			if (!mediaItem.statusChanging)
			{
				var targetEl = $(event.currentTarget);
				mediaItem.statusChanging = true;
				DisplayTinyLoadingIndicator(targetEl.parent().find('.spinner'));
				mediaServices.setApprovalStatus([mediaItem.ID], approve ? 1 : 0)
					.then(function ()
					{
						// Remove the media item from the dateGroup it falls under
						for(var i = 0; i < dateGroup.items.length; i++)
						{
							if (dateGroup.items[i].ID === mediaItem.ID)
								dateGroup.items.splice(i, 1);
						}

						if (dateGroup.items.length < 1)
							$scope.removeDateGroup(dateGroup.date, targetEl.closest('li'));

						targetEl.closest('.button-container.approval').hide();
						targetEl.closest('.item-thumbnail').children('div.item-container').hide({
							effect: 'slide',
							direction: 'left',
							duration: 300,
							complete: function() {
								$(this).remove();
							}
						});
					}, function ()
					{
						InfoDialog('Set Media Approval Status', 'The approval status for media item ' + mediaItem.ID + ' could not be changed.<br/>' +
							'The item may have been deleted or you may not have permission.');
					})
					.finally(function() {
						mediaItem.statusChanging = false;
						HideTinyLoadingIndicator(targetEl.parent().find('.spinner'));
					});
			}
		};

		/**
		 * Sets the approval status for all the elements within the specified date group
		 */
		$scope.bulkApproveMediaItems = function(dateGroup, approve)
		{
			var idArray = [];
			$.each(dateGroup.items, function(i, item) {
				idArray.push(item.ID);
			});

			// Disallow more than one attempt to change the status
			if (!dateGroup.statusChanging)
			{
				var targetEl = $(event.currentTarget);
				dateGroup.statusChanging = true;
				DisplayTinyLoadingIndicator(targetEl.parent().find('.spinner'));
				mediaServices.setApprovalStatus(idArray, approve ? 1 : 0)
					.then(function () {
						targetEl.closest('.button-container.bulk-approval').hide();
						$scope.removeDateGroup(dateGroup.date, targetEl.closest('li'));
					}, function (error) {
						InfoDialog('Set Media Approval Status', 'The approval status for ' + isArray.length + ' media items could not be changed.<br/>' +
							'Some items may have been deleted or you may not have permission.');
					})
					.finally(function() {
						dateGroup.statusChanging = false;
						HideTinyLoadingIndicator(targetEl.parent().find('.spinner'));
					});
			}
		};

		$scope.removeDateGroup = function(date, dateGroupEl)
		{
			dateGroupEl.hide({
				effect: 'slide',
				direction: 'left',
				duration: 300,
				complete: function() {
					$(this).remove();

					// Remove the date group from the array of groups
					$.each($scope.dateGroups, function(i, item) {
						if (item)
						{
							if (item.date === date)
								$scope.dateGroups.splice(i, 1);
						}
					});

					$scope.$apply();
				}
			});
		};

		$scope.thumbnailImageUrl = function(mediaItem)
		{
			if ($scope.isSupportedImageMimeType(mediaItem.MimeType))
				return BM.options.incidentMediaBaseUrl + mediaItem.Path;
			else
				return '/images/Video-Placeholder.png';
		};

		$scope.isSupportedImageMimeType = function(mimeType)
		{
			return mimeType ? mimeType.match(/image\/[a-zA-Z0-9\-\/]*/g) : false;
		};

		$scope.isSupportedVideoMimeType = function(mimeType)
		{
			return mimeType ? mimeType.match(/video\/[a-zA-Z0-9\-\/]*/g) : false;
		};

		$scope.getMediaForModeration();
	}]).directive('mediaDateGroup', [function() {
		return {
			link: function(scope, element, attr) {
				element.find('.button').tooltipster({
					position: 'top'
				});

				element.find('.panel-section-heading').click(function(event) {
					self.togglePanelHeader(event);
				});
			}
		}
	}]).directive('mediaThumbnailImage', [function() {
		return {
			link: function(scope, element, attr) {
				element.tooltipster({
					content: $("<div class=\"media-thumbnail-tooltip-enlarged\" style=\"background-image: url('" + attr.ngSrc + "')\"></div>"),
					position: 'left',
					offsetX: -5,
					hideOnClick: true,
					theme: 'tooltipster-default minimal-padding'
				});
			}
		};
	}]);
};

BM.RightSidebarPanel.MediaModeration.prototype = Object.create(BM.RightSidebarPanel.prototype);
BM.RightSidebarPanel.MediaModeration.prototype.constructor = BM.RightSidebarPanel.MediaModeration;

BM.RightSidebarPanel.MediaModeration.prototype.init = function()
{
	if (!BM.currentWPUser.administrator && !BM.currentWPUser.editor)
		this.setEnabled(false);
};

/**
 * Requery the datasource and refresh the note lists
 */
BM.RightSidebarPanel.MediaModeration.prototype.refreshModerationList = function()
{
	this._scope.getMediaForModeration();
};

/**
 * Refresh the moderation list on panel activation
 * @param {boolean} skipAnimation
 */
BM.RightSidebarPanel.MediaModeration.prototype.show = function(skipAnimation)
{
	BM.RightSidebarPanel.prototype.show.call(this, skipAnimation);

	var self = this;
	setTimeout(function() {
		self.refreshModerationList();
	}, 500);
};