/**
 * @param {jQuery} resultTargetEl
 * @constructor
 * @class
 * @extends {BM.SearchSource.ES}
 */
BM.SearchSource.ES.IncidentNote = function(resultTargetEl)
{
	BM.SearchSource.ES.call(this, 'Incident Notes', resultTargetEl, 'avw_incident_notes', 'incident_note', ['Title', 'Body', 'Author.Name']);
};

BM.SearchSource.ES.IncidentNote.prototype = Object.create(BM.SearchSource.ES.prototype);
BM.SearchSource.ES.IncidentNote.prototype.constructor = BM.SearchSource.ES.IncidentNote;

BM.SearchSource.ES.IncidentNote.prototype.generateResultHeader = function(data)
{
	return data._source.Author.Name + ' on ' + moment(data._source.Created).format('DD/MM/YYYY');
};

BM.SearchSource.ES.IncidentNote.prototype.generateResultSubtext = function(data)
{
	return this.getHighlight(data);
};

BM.SearchSource.ES.IncidentNote.prototype.handleResultSelected = function(data)
{
	alert(data._source.Title + ' selected');
};