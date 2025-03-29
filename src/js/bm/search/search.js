
BM.Search = (function() {
	var _searchShowButton = $('#search-show-button');
	var _searchContainer = $('#search-container');
	var _searchInput = $('#search-input');
	var _searchClearButton = $('#search-clear-button');
	var _searchResultsContainer = $('#search-results-container');
	var _similarTerms = $('#search-similar-terms');
	var _searchCategories = $('#search-categories');

	var _isShowing = false;
	var _prevSearchText = '';

	/** @type {[BM.SearchSource]} */
	var _sources = [
		new BM.SearchSource.ES.Operation(_searchCategories),
		new BM.SearchSource.ES.Incident(_searchCategories),
		new BM.SearchSource.ES.IncidentNote(_searchCategories),
		new BM.SearchSource.ES.Media(_searchCategories),
		new BM.SearchSource.ES.Person(_searchCategories)
	];

	/**
	 * @private
	 */
	function _init()
	{
		_searchShowButton
			.click(function() {
				if (_isShowing)
					_hide();
				else
					_show();
			})
			.tooltipster({
				position: 'left',
				hideOnClick: true
			});
		
		_searchClearButton.click(function() {
			_clear();
		});

		_searchInput
			.on('keydown', function(event) {
				// If the escape key is pressed, clear and hide the search box and results container
				if (event.which === 27)
				{
					if (_searchInput.val())
					{
						_clear();
						_showResultsContainer(false);
					}
					else
					{
						_hide();
					}
				}
			}).on('keyup', function(event) {
				var newSearchText = _searchInput.val();
				if (newSearchText != _prevSearchText)
				{
					_prevSearchText = newSearchText;
					_searchText(newSearchText);
				}
			});

		_searchResultsContainer.mCustomScrollbar({
			autoHideScrollbar: false,
			scrollInertia: 200,
			mouseWheel: {
				scrollAmount: 100
			},
			theme: 'dark-3',
			advanced: {
				updateOnContentResize: true
			}
		});

		// Replace browser's Ctrl+F with Battle Map search
		$(window).on('keydown', function(event) {
			if (event.ctrlKey && event.which === 70)
			{
				_show();
				event.preventDefault();
			}
		});
	}

	/**
	 * Shows the search input and results panel
	 * @private
	 */
	function _show()
	{
		_searchShowButton.addClass('active');
		_searchContainer.fadeIn(200, function() {
			_searchInput.focus();
		});

		_isShowing = true;
	}

	function _hide()
	{
		_searchShowButton.removeClass('active');
		_searchContainer.fadeOut(200);
		_isShowing = false;
	}

	/**
	 * Performs a full-text query using Elasticsearch and displays the top results
	 * @param {string} query
	 * @private
	 */
	function _searchText(query)
	{
		if (!_searchInput.val())
			_showResultsContainer(false);
		else
			_showResultsContainer(true);

		// TODO: Sort categories by search score

		// Conduct search against each registered source
		for(var i = 0; i < _sources.length; i++)
		{
			_sources[i].search(query);
		}

		_suggestFromQuery(query);
	}

	/**
	 * Populates the suggested terms based on a fuzzy query
	 * @param {string} query
	 * @private
	 */
	function _suggestFromQuery(query)
	{
		var suggestions = 0;
		_similarTerms.empty();

		$.ajax({
			url: '/api/es/suggest/avw_contacts',
			method: 'POST',
			dataType: 'json',
			contentType: 'application/json',
			data: JSON.stringify({
				"suggest": {
					"text": query,
					"term": {
						"field": "_all"
					}
				}
			})
		}).done(function(data) {
			if (data.suggest.length > 0)
			{
				suggestions = data.suggest[0].options.length;
				$.each(data.suggest[0].options, function (i, option) {
					var term = $(document.createElement('span'))
						.addClass('term')
						.append('<em>' + option.text + '</em><span class="term-freq"> (' + option.freq.toLocaleString() + ')</span>')
						.click(function ()
						{
							_searchInput.val(option.text);
							_searchText(option.text);
							_searchInput.focus();
						});

					_similarTerms.append(term);
				});
			}

			if (!suggestions)
				_similarTerms.hide();
			else
				_similarTerms.show();
		}).fail(function() {
			_similarTerms.hide();
		});
	}

	function _clear()
	{
		_searchResultsContainer.hide();
		_searchInput.val('');
		_searchInput.focus();
	}

	function _showResultsContainer(show)
	{
		if (show)
			_searchResultsContainer.show();
		else
			_searchResultsContainer.hide();
	}

	return {
		init: _init,
		searchText: _searchText
	};
}());