/**
 * @param {jQuery} resultTargetEl
 * @constructor
 * @class
 * @extends {BM.SearchSource.ES}
 */
BM.SearchSource.ES.Operation = function(resultTargetEl)
{
	BM.SearchSource.ES.call(this, 'Operations', resultTargetEl, 'avw_operations', 'operation', ['Operation']);
};

BM.SearchSource.ES.Operation.prototype = Object.create(BM.SearchSource.ES.prototype);
BM.SearchSource.ES.Operation.prototype.constructor = BM.SearchSource.ES.Operation;

BM.SearchSource.ES.Operation.prototype.generateResultHeader = function(data)
{
	return this.getHighlight(data);
};

BM.SearchSource.ES.Operation.prototype.generateResultSubtext = function(data)
{
	var startDate = moment(data._source.Start_Date).format('DD/MM/YYYY');
	var endDate = moment(data._source.End_Date).format('DD/MM/YYYY');
	return startDate + ' - ' + endDate;
};

BM.SearchSource.ES.Operation.prototype.handleResultSelected = function(data)
{
	BM.FilterPanel.contactFilterController.clearAllFilters();
	var opFilter = BM.FilterPanel.contactFilterController.getFilterById(BM.FilterID.contact.operationName);
	opFilter.check(function() {
		opFilter.setValues([data._source.Operation]);
		BM.FilterPanel.applyFilter(true, function() {
			opFilter.deactivateFilterControl();
		});
	});
};