
BM.QuickStartGuide = (function() {
	var _scope = undefined;

	BM.angularApp.controller('quickStartGuideController', ['$scope', function($scope) {
		_scope = $scope;
		$scope.showing = false;
		$scope.steps = [
			{
				imageUrl: '/images/quick-start-guide/Sidebar.jpg',
				title: 'Sidebar',
				caption: 'Access key features and customise the map.'
			},
			{
				imageUrl: '/images/quick-start-guide/Main-Map.jpg',
				title: 'The Map',
				caption: 'Explore rich collections of official and community contributed material.'
			},
			{
				imageUrl: '/images/quick-start-guide/Timeline.jpg',
				title: 'Timeline',
				caption: 'Analyse incidents and other events by date, using the Timeline.'
			},
			{
				imageUrl: '/images/quick-start-guide/Media-Reel.jpg',
				title: 'Media Reel',
				caption: 'Browse collections of geotagged photos/videos and upload your own.'
			},
			{
				imageUrl: '/images/quick-start-guide/Toolbox.jpg',
				title: 'Toolbox',
				caption: 'Create an account today, to contribute your story.'
			}
		];

		$scope.currentStepIndex = 0;
		$scope.currentStep = $scope.steps[0];
		$scope.stepTitle = '';

		$scope.open = function()
		{
			$scope.currentStepIndex = 0;
			$scope.currentStep = $scope.steps[0];
			$scope.showing = true;
			$scope.$apply();
		};

		$scope.close = function()
		{
			$scope.showing = false;
			localStorage.setItem('quickStartGuideCompleted', true);
		};

		$scope.goStep = function(index)
		{
			if (index < 0 || index >= $scope.steps.length)
			{
				$scope.close();
			}
			{
				$scope.currentStepIndex = index;
				$scope.currentStep = $scope.steps[index];
			}

			localStorage.setItem('quickStartGuideCompleted', true);
		};

		$scope.nextStep = function()
		{
			$scope.goStep($scope.currentStepIndex + 1);
			localStorage.setItem('quickStartGuideCompleted', true);
		};

		$scope.getNextButtonText = function()
		{
			return ($scope.currentStepIndex === $scope.steps.length - 1) ? 'Close' : 'Next';
		};

		// Close if ESC is pressed
		$(window).on('keydown', function(event) {
			if (event.keyCode === 27)
			{
				$scope.close();
				$scope.$apply();
			}
		});
	}]);

	function _open()
	{
		_scope.open();
	}

	return {
		open: _open
	};
})();