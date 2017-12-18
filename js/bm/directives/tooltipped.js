/**
 * Binds a tooltipster tooltip to the specified element
 * @attribute title - Text to use in the tooltip
 * @attribute side - The side on which to display the tooltip
 * @attribute distance - Gap in pixels between tooltip arrow and element
 * @attribute show - Stringified boolean value determining whether to show the tooltip at runtime
 * @attribute trigger - What triggers the tooltip to open: 'hover', 'click' or 'custom'
 */
BM.angularApp.directive('tooltipped', [function() {
	return {
		restrict: 'A',
		link: function($scope, element, attrs, ngModel) {
			var side = attrs.side || ['top', 'bottom', 'left', 'right'];
			var distance = !isNaN(parseInt(attrs.distance)) || 2;
			var show = attrs.show ? (attrs.show != 'false') : true;
			var trigger = attrs.trigger || 'hover';

			// If the title changes, update the tooltip content
			attrs.$observe('title', function(value) {
				element.tooltipster('content', value);
			});

			element.tooltipster({
				content: attrs.title,
				side: side,
				distance: distance,
				trigger: trigger,
				functionBefore: function() {
					return show;
				}
			});
		}
	}
}]);