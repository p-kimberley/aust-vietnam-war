/**
 * @param {jQuery} resultTargetEl
 * @constructor
 * @class
 * @extends {BM.SearchSource.ES}
 */
BM.SearchSource.ES.Media = function(resultTargetEl)
{
	BM.SearchSource.ES.call(this, 'Photos and Videos', resultTargetEl, 'avw_incident_media', 'incident_media', ['FileName', 'Description', 'Author.Name', 'Tags.Name']);
};

BM.SearchSource.ES.Media.prototype = Object.create(BM.SearchSource.ES.prototype);
BM.SearchSource.ES.Media.prototype.constructor = BM.SearchSource.ES.Media;

BM.SearchSource.ES.Media.prototype.generateResultHeader = function(data)
{
	return '<img class="thumbnail" src="' + BM.options.incidentMediaBaseUrl + data._source.Path + '"/>' + data._source.FileName;
};

BM.SearchSource.ES.Media.prototype.generateResultSubtext = function(data)
{
	return this.getHighlight(data);
};

BM.SearchSource.ES.Media.prototype.handleResultSelected = function(data)
{
	alert(data._source.FileName + ' selected');
};