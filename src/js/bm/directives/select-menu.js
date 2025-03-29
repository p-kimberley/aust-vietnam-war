/**
 * A jQueryUI selectmenu control, encapsulated in an Angular directive
 */
BM.angularApp.directive('selectMenu', [function() {
	return {
		restrict: 'A',
		require: 'ngModel',
		link: function($scope, elm, attrs, ctrl)
		{
			// View to model
			elm.on('selectmenuchange', function () {
				ctrl.$setViewValue(elm.val());
			});

			// Model to view
			ctrl.$render = function () {
				elm.val(ctrl.$viewValue);
				elm.selectmenu('refresh');
			};

			// Initialisation
			elm.selectmenu({
				width: false
			});
		}
	}
}]);