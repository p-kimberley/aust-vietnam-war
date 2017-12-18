/**
 * Binds a tooltipster tooltip to the specified element
 */
BM.angularApp.directive('poppyTooltip', [function() {
	return {
		restrict: 'A',
		link: function($scope, element, attrs, ngModel) {
			// If tributes are added, update the tooltip
			$scope.$watch('person._source.Tributes.length', function(value, oldValue) {
				element.tooltipster('content', $scope.getPoppyTooltipContent());
			});

			$scope.getPoppyTooltipContent = function()
			{
				var tributes = $scope.person._source.Tributes;
				var hasText = false;

				$.each(tributes, function(i, item) {
					if (item.Comment)
					{
						hasText = true;
						return false;
					}
				});

				if (!hasText)
				{
					return tributes.length + ' ' + (tributes.length > 1 ? 'poppies' : 'poppy');
				}
				else
				{
					var container = $(document.createElement('div'))
						.addClass('poppy-tooltip-comments');

					$.each(tributes, function(i, item) {
						if (item.Comment)
						{
							var author = item.Author_Name ? item.Author_Name + ': ' : '';
							container.append('<span><strong>' + author + '</strong>' + item.Comment + '</span>');
						}
					});

					return container;
				}
			};

			element.tooltipster({
				content: $scope.getPoppyTooltipContent(),
				side: 'left',
				distance: -2
			});
		}
	}
}]);