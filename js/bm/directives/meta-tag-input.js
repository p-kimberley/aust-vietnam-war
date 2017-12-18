
/**
 * Captures metadata 'tags' from the user. Uses Select2 component.
 */
BM.angularApp.directive('metaTagInput', ['$http', '$timeout', '$log', function($http, $timeout, $log) {
	return {
		restrict: 'A',
		require: 'ngModel',
		link: function($scope, element, attrs, ngModel) {
			// View to model
			element.on('change', function() {
				var newVal = element.val() || [];
				ngModel.$setViewValue(newVal);
			});

			// Model to view
			$scope.$watch(function() {
				return ngModel.$modelValue;
			}, function(value) {
				$timeout(function() {
					element.val(value).trigger('change.select2');
				});
			});

			// Populate the Select2 tag control with a list of all available tags, to enable autocomplete
			// TODO: Refactor this to use a remote searching method, once the tag repository grows larger
			var availableTags = [];
			$http.post('/api/es/search/avw_incident_media', {
				"size": 0,
				"aggs": {
					"tags": {
						"terms": {
							"field": "Tags.Name.raw",
							"size": 1000
						}
					}
				}
			}).then(function(response) {
				$.each(response.data.aggregations.tags.buckets, function(i, item) {
					availableTags.push({
						id: item.key,
						text: item.key
					});
				});

				element.select2({
					tags: true,
					tokenSeparators: [',', ';'],
					data: availableTags
				});

				// Hide the Select2 component if the bound select control is hidden
				$scope.$watch(attrs.ngHide, function(value, oldValue) {
					if (value)
						element.next('span.select2').hide();
					else
						element.next('span.select2').show();
				});

			}, function(error) {
				$log.error('Could not query available tags. Error: ' + error.statusText);
			});

			element.select2({
				tags: true,
				tokenSeparators: [',', ';']
			});
		}
	}
}]);