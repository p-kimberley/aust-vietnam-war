/**
 * General utility services
 */
BM.angularApp.service('BM.services.utility', function() {
	this.decodeURIComponent = function(uri)
	{
		return uri ? decodeURIComponent(uri) : null;
	};

	this.isUserLoggedIn = function()
	{
		return BM.currentWPUser.ID > 0;
	};

	this.isPrivilegedUser = function()
	{
		return BM.currentWPUser.editor || BM.currentWPUser.administrator;
	};

	this.getUserName = function()
	{
		return BM.currentWPUser.displayName;
	};

	this.getUserProfileUrl = function(userName)
	{
		return '/members/' + userName + '/profile';
	};
});