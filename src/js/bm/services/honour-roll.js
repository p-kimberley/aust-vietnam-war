/**
 * Honour-roll related services
 */
BM.angularApp.service('BM.services.honourRoll', ['BM.services.utility', function(utilityServices) {
	/**
	 * Enables the display of the 'add poppy' button if the user hasn't submitted a poppy against a given person in the past 24 hours
	 * @param {{}} person
	 * @returns {boolean}
	 */
	this.addPoppyButtonEnabled = function(person)
	{
		var timeCompare = moment().subtract(1, 'day');
		var currentUser = BM.currentWPUser.ID;
		var lastSubmitted = localStorage.getItem('tribute-submitted-' + person.NR_ID);
		var lastTimeSubmitted = undefined;
		var enableButton = true;

		// Get the time of last tribute submission against this person if it exists, from local storage
		if (lastSubmitted && lastSubmitted != "")
		{
			lastTimeSubmitted = moment(lastSubmitted);
			if (!lastTimeSubmitted.isValid())
				lastTimeSubmitted = undefined;
		}

		$.each(person.Tributes, function(i, tribute) {
			if (!BM.currentWPUser.administrator && ((currentUser > 0 && currentUser == tribute.Author && moment(tribute.Created) > timeCompare) || (lastTimeSubmitted && lastTimeSubmitted > timeCompare)))
			{
				enableButton = false;
				return false;
			}
		});

		return enableButton;
	};

	this.getTributeInputPlaceholderText = function()
	{
		if (!utilityServices.isUserLoggedIn())
			return "(Optional) Login to leave a tribute along with your poppy";
		else
			return "(Optional) Leave a tribute along with your poppy";
	};

	this.isTributeInputEnabled = function()
	{
		return utilityServices.isUserLoggedIn();
	};

	this.getCasImageUrl = function(cas)
	{
		if (cas && cas.Media && cas.Media.length > 0)
			return '/honour-roll/' + cas.Media[0].Image_Url;
	};

	this.showCasDialog = function(cas)
	{
		BM.CasualtyInfoDialog.show(cas);
	};

	/**
	 * Displays a tooltip requesting an optional comment and for the user to submit their tribute
	 * @param person
	 * @param event
	 */
	this.showAddTributePopup = function(person, event)
	{
		if (event)
		{
			var target = $(event.target);
			var personEntry = target.closest('li');

			// Prevent the person's info dialog being triggered
			event.stopPropagation();

			// Close any existing popups before opening the new one
			personEntry.siblings('li').tooltipster('close');

			personEntry.tooltipster('open', function(instance, helper) {
				$(helper.tooltip).find('textarea').focus();
			});
		}
	};
}]);