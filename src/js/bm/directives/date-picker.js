/**
 * A jQueryUI datepicker control, encapsulated in an Angular directive
 */
BM.angularApp.directive('datePicker', [function() {
	return {
		require: 'ngModel',
		link: function($scope, elm, attrs, ctrl) {
			// View to model
			elm.on('change', function() {
				ctrl.$setViewValue(elm.val());
			});

			// Model to view
			ctrl.$render = function() {
				elm.datepicker('setDate', ctrl.$viewValue);
			};

			// Hide the jQuery UI datepicker calendar icon if the datepicker input box is hidden
			$scope.$watch(attrs.ngHide, function(value, oldValue) {
				if (value)
					elm.next('img').hide();
				else
					elm.next('img').show();
			});

			// Initialisation
			elm.datepicker({
				changeMonth: true,
				changeYear: true,
				dateFormat: 'dd/mm/yy',
				yearRange: '1960:',
				maxDate: new Date(),
				showAnim: 'slideDown',
				showOn: 'both',
				buttonImage: '/images/Calendar-Icon.png',
				buttonImageOnly: true
			});

			// Validation
			ctrl.$validators.datePicker = function(modelValue, viewValue) {
				if (elm.attr('required') == 'required')
				{
					if (ctrl.$isEmpty(modelValue))
					{
						return false;
					}
					else
					{
						var parsedDate = moment(modelValue, 'DD/MM/YYYY');
						if (parsedDate.isValid())
						{
							// If the parsed date differs from the text within the input control, the user must have
							// manually entered an invalid date. Treat this is a validation error.
							if (parsedDate.format('DD/MM/YYYY') != viewValue)
								return false;
							else
								return parsedDate.isBefore();
						}
						else
						{
							return false;
						}
					}
				}
				else
				{
					return true;
				}
			};
		}
	}
}]);