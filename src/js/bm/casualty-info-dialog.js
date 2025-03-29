// Displays information on a particular casualty
BM.CasualtyInfoDialog = (function() {
	var _scope;
	var _dialog = $('#casualty-info-dialog')
		.hide()
		.draggable({
			handle: '.heading'
		});

	$('#cas-info-tabs').tabs({
		heightStyle: 'auto'
	});

	BM.angularApp.controller('casualtyInfoController', ['$scope', '$http', '$timeout', function($scope, $http, $timeout) {
		_scope = $scope;
		$scope.cas = undefined;
		$scope.tours = undefined;

		$scope.displayCasInfo = function(cas)
		{
			// Retrieve detailed info including the person's service history
			if (cas)
			{
				$scope.tours = cas.Tours;
				$scope.cas = cas;
				$('#cas-info-tabs').tabs('refresh');
			}
		};

		$scope.casDisplayName = function()
		{
			if (!$scope.cas)
				return '';

			var cas = $scope.cas;
			if (cas.Last_Name === 'null')
			{
				return '';
			}
			else
			{
				return cas.Last_Name + ', ' + (cas.First_Name ? cas.First_Name + ' ' : '') +
					(cas.Second_Name ? cas.Second_Name + ' ' : '') +
					(cas.Third_Name ? cas.Third_Name : '');
			}
		};

		$scope.casAge = function()
		{
			if ($scope.cas)
				return Math.abs(moment($scope.cas.Birth.Date).diff(moment($scope.cas.Death.Date), 'years'));
			else
				return 0;
		};

		$scope.casPortraitUrl = function()
		{
			if ($scope.cas)
				return '/honour-roll/' + $scope.cas.Service_Number + '.jpg';
			else
				return '';
		};

		$scope.tourDuration = function(tour)
		{
			if (tour)
			{
				var duration = Math.abs(moment(tour.Start_Date).diff(moment(tour.End_Date), 'days')) + 1;
				if (isNaN(duration))
					return "Unknown";
				else if(duration === 1)
					return duration + " day";
				else
					return duration + " days";
			}
			else
			{
				return 0;
			}
		};

		$scope.totalDaysInVietnam = function()
		{
			if ($scope.tours)
			{
				var totalDays = 0;
				$.each($scope.tours, function(i, tour) {
					var startDate = moment(tour.Start_Date);
					var endDate = moment(tour.End_Date);
					totalDays += Math.abs(startDate.diff(endDate, 'days')) + 1;
				});
			}

			return totalDays;
		};
	}]);

	function _show(cas)
	{
		_dialog.fadeIn(200);
		_scope.displayCasInfo(cas);
	}

	function _hide()
	{
		_dialog.fadeOut(200);
	}

	return {
		show: _show,
		hide: _hide
	}
})();