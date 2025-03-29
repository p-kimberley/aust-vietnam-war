/**
 * Binds a tooltip to the nearest list item, which captures a user tribute for submission
 */
BM.angularApp.directive('casualtyListItem', [function() {
	return {
		restrict: 'A',
		link: function($scope, element, attrs, ngModel) {
			/**
			 * Tracks whether the input tooltip is currently showing
			 * @type {boolean}
			 */
			$scope.showingPopup = false;

			/**
			 * @type {string}
			 */
			$scope.tributeInput = null;

			// Tooltip displaying tribute entry dialog
			element.tooltipster({
				side: 'left',
				distance: -5,
				trigger: 'custom',
				triggerClose: {
					click: true,
					tap: true
				},
				interactive: true,
				trackOrigin: true,
				theme: ['tooltipster-light', 'battlemap-tooltip-dark', 'minimal-padding'],
				functionInit: function(instance, helper) {
					var content = $(helper.origin).find('.tooltip-input-tribute');
					instance.content(content);
				},
				functionReady: function(instance, helper) {
					$scope.showingPopup = true;
					$scope.tributeInput = null;
				},
				functionAfter: function(instance, helper) {
					$scope.showingPopup = false;
				}
			});

			$scope.$watch('showingPopup', function(value, oldValue) {
				if (!value && value != oldValue)
					element.tooltipster('close');
			});

			// If the Escape key is pressed, cancel tribute submission
			var closeTooltip = function(event) {
				if (event.which === 27)
					element.tooltipster('close');
			};

			$('body').on('keydown', closeTooltip);

			element.on('$destroy', function() {
				$('body').off('keydown', closeTooltip);
			});

			/**
			 * Aborts the submission of the tribute
			 */
			$scope.cancelAddTribute = function()
			{
				$scope.showingPopup = false;
			};

			/**
			 * Adds a poppy to the specified person
			 * @param {{}} person
			 */
			$scope.addTribute = function(person)
			{
				localStorage.setItem('tribute-submitted-' + person.NR_ID, moment().toISOString());
				$.post('/src/php/bm/add-tribute.php', JSON.stringify({
					person: person.NR_ID,
					comment: $scope.tributeInput ? encodeURIComponent($scope.tributeInput) : null
				})).done(function(response) {
					if (parseInt(response) === 1)
					{
						person.Tributes.unshift({
							NR_ID: person.NR_ID,
							Comment: $scope.tributeInput,
							Author: BM.currentWPUser.ID > 0 ? BM.currentWPUser.ID : null,
							AuthorName: BM.currentWPUser.displayName,
							Created: moment().toISOString()
						});

						$scope.showingPopup = false;
						$scope.$apply();
					}
				});
			};
		}
	}
}]);