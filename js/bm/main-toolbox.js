
BM.MainToolbox = (function() {
	var _leftSidebarContainer = $('#left-sidebar-container');
	var _mediaReel = $('#media-reel');
	var _toolbox = $('#map-main-toolbox');
	var _scope = null;
	var _aboutDialog = $('#dialog-about').dialog({
		closeOnEscape: true,
		title: 'About',
		minWidth: 380,
		autoOpen: false,
		modal: true,
		show: {
			effect: 'fade',
			duration: 200
		},
		hide: {
			effect: 'fade',
			duration: 200
		},
		buttons: [{
			text: 'Close',
			class: 'default',
			click: function() {
				$(this).dialog('close');
			}
		}],
		open: function() {
			$(this).dialog('instance').uiDialogButtonPane.find('button').focus();
		}
	});

	BM.angularApp.controller('mainToolboxController', ['$scope', '$http', '$log', '$animate', 'BM.services.utility',
		function ($scope, $http, $log, $animate, utilityServices)
		{
			_scope = $scope;
			$scope.utilityServices = utilityServices;
			$scope.userIsLoggedIn = false;
			$scope.logoutUrl = '';
			$scope.userFlyoutHeader = 'Account Options';

			$http.get('/php/bm/get-logout-url.php')
				.then(function (response)
				{
					var url = utilityServices.decodeURIComponent(response.data);

					// WordPress encodes ampersands as the HTML literal equivalent (&amp;). Replace these otherwise the logout URL redirect will not work.
					$scope.logoutUrl = url ? url.replace(/(&amp;)/g, '&') : '';
				}, function (error)
				{
					$log.error('Logout URL could not be retrieved. ' + error);
				});

			if (BM.currentWPUser.ID > 0)
			{
				$http.get('/php/bm/get-user-meta.php?' + $.param({
						userIDArray: BM.currentWPUser.ID,
						avatarSize: 48
					})).then(function (response)
				{
					$scope.userMeta = response.data[0];
					if ($scope.userMeta)
						$scope.userIsLoggedIn = true;
				}, function (error)
				{
					$scope.userIsLoggedIn = false;
					$log.error('User metadata for ID ' + BM.currentWPUser.ID.toString() + ' could not be retrieved. ' + error);
				});
			}
		}]);

	$(document).ready(function() {
		_init();
	});

	function _init()
	{
		_toolbox.find('.flyout').hide();
		_toolbox.find('.toolbox-icon')
			.on('mouseenter', function(event) {
				_closeAllFlyouts();
				var flyout = $(event.target).next('.flyout');
				flyout.stop(false, true).show({
					effect: 'slide',
					direction: 'left',
					duration: 200
				});
			})
			.on('mouseleave', function(event) {
				_closeAllFlyouts();
			})
			.on('click', function(event) {
				var item = $(event.target).closest('.toolbox-item');
				var flyoutPanel = item.find('.flyout-panel');
				if (flyoutPanel.length > 0)
				{
					// If the item already has a flyout menu open, close it
					if (item.hasClass('active'))
						_closeActiveFlyouts();
					else
					{
						_closeActiveFlyouts();
						item.toggleClass('active');
						item.find('.flyout').toggleClass('active');
						flyoutPanel.toggle({
							effect: 'slide',
							direction: 'down',
							duration: 150
						});
					}
				}
			});

		_toolbox.find('a').click(function() {
			_closeActiveFlyouts();
			_closeAllFlyouts();
		});
	}

	function _closeAllFlyouts()
	{
		_toolbox.find('.flyout').not('.active').stop(false, true).hide();
	}

	function _closeActiveFlyouts()
	{
		var activeFlyouts = _toolbox.find('.flyout.active');
		activeFlyouts.find('.flyout-panel')
			.hide({
				effect: 'slide',
				direction: 'down',
				duration: 200
			})
			.closest('.flyout').hide({
				effect: 'slide',
				direction: 'left',
				duration: 200
			})
			.removeClass('active');

		activeFlyouts.closest('.toolbox-item').removeClass('active');
		activeFlyouts.removeClass('active');
	}

	function _showAboutDialog()
	{
		_aboutDialog.dialog('open');
	}

	return {
		closeActiveFlyouts: _closeActiveFlyouts,
		closeAllFlyouts: _closeAllFlyouts,
		showAboutDialog: _showAboutDialog
	}
})();