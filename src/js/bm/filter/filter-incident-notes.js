/**
 * Enables the user to filter by whether the incident has notes entered against it or not
 * @param label
 * @constructor
 * @extends {BM.Filter.SingleSelectList}
 */
BM.Filter.IncidentNotes = function(label)
{
	BM.Filter.SingleSelectList.call(this, BM.FilterID.contact.hasNotes, label, 'Incident_Notes', { nameValueArray: [{ name: 'Yes', value: 1 }, { name: 'No', value: 0 }]});
	this.useInAnalytics = false;
};

BM.Filter.IncidentNotes.prototype = Object.create(BM.Filter.SingleSelectList.prototype);
BM.Filter.IncidentNotes.prototype.constructor = BM.Filter.IncidentNotes;

/**
 * Override, due to using a different data service comparison operator
 */
BM.Filter.IncidentNotes.prototype.toDataFilterString = function()
{
	if (this.values[0] == 1)
		return this.dataField + " gt 0";
	else
		return this.dataField + " eq 0";
};

BM.Filter.IncidentNotes.prototype.toElasticSearchFilter = function()
{
	if (this.values[0] == 1)
		return JSON.parse('{ "range": { "' + this.dataField + '": { "gt": 0 }}}');
	else
		return JSON.parse('{ "match": { "' + this.dataField + '": 0 }}');
};